import { fetchTabImages, fetchTabImagesBatch, matchTabGid } from './sheetTabsApi.js';
import {
  auditBillsForFraud,
  attachFraudFlagsToVouchers,
} from './expenseFraudAudit.js';

const MAX_IMAGES_PER_VOUCHER = 8;

const parseMoney = (val) => {
  const n = parseFloat(String(val ?? '').replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

export const extractImageUrlsFromMatrix = (matrix) => {
  const urls = new Set();
  for (const row of matrix || []) {
    for (const cell of row || []) {
      const s = String(cell ?? '');
      const m = s.match(/IMAGE\s*\(\s*["']([^"']+)["']/i);
      if (m?.[1]) urls.add(m[1].replace(/\\"/g, '"'));
      if (/^https?:\/\//i.test(s) && /googleusercontent|ggpht|gstatic|drive/i.test(s)) {
        urls.add(s.trim());
      }
    }
  }
  return [...urls];
};

const travelImageCap = (voucher) => {
  const travelDays = (voucher.dateBlocks || []).filter(
    (d) =>
      (d.travel || 0) > 0 ||
      (d.petrolTravel || 0) > 0 ||
      (d.accommodation || 0) > 0 ||
      (d.localConveyance || 0) > 0,
  ).length;
  return Math.min(MAX_IMAGES_PER_VOUCHER, Math.max(3, travelDays || 3));
};

export const analyzeBillImages = async (imageUrls, context = {}) => {
  if (!imageUrls?.length) {
    return { bills: [], tickets: [], totalFromTickets: 0, imageCount: 0, raw: '' };
  }
  const res = await fetch('/api/ai/analyze-bill-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrls: imageUrls.slice(0, MAX_IMAGES_PER_VOUCHER), context }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Image analysis failed (HTTP ${res.status})`);
  }
  return res.json();
};

const analyzeBillImagesBulk = async (batches) => {
  if (!batches?.length) {
    return { byKey: {}, totals: { uniqueImages: 0, cacheHits: 0, vouchers: 0 } };
  }
  const res = await fetch('/api/ai/analyze-bill-images-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batches }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Bulk OCR failed (HTTP ${res.status})`);
  }
  return res.json();
};

const normDate = (d) => String(d || '').replace(/[^0-9]/g, '');

const datesMatch = (a, b) => {
  const na = normDate(a);
  const nb = normDate(b);
  if (!na || !nb) return false;
  return na === nb || na.slice(-6) === nb.slice(-6) || na.includes(nb.slice(-4)) || nb.includes(na.slice(-4));
};

export const attachTicketAnalysisToDates = (dateBlocks, tickets) => {
  return dateBlocks.map((block) => {
    const matched = tickets.filter((t) => datesMatch(t.date, block.date));
    const ticketSum = matched.reduce((s, t) => s + (t.amount || 0), 0);
    const compareAmount = block.isPetrolDay ? block.petrolTravel : block.travel;
    const compareSubtotal = block.ticketComparable || block.travel + block.localConveyance;

    return {
      ...block,
      ticketsFromImages: matched,
      ticketAmountFromImages: ticketSum,
      manualMatchesImages:
        ticketSum > 0
          ? Math.abs(ticketSum - compareAmount) <= 5 ||
            Math.abs(ticketSum - compareSubtotal) <= 5
          : null,
      imageCompareTarget: block.isPetrolDay ? compareAmount : compareSubtotal,
    };
  });
};

const buildEnrichedVoucher = (voucher, gid, imageUrls, analysis) => {
  const dateBlocksWithTickets = attachTicketAnalysisToDates(
    voucher.dateBlocks,
    analysis.tickets || [],
  );

  const manualTickets = voucher.dateWiseTicketsSum || 0;
  const manualPetrol = voucher.dateWisePetrolSum || 0;
  const fromTickets = analysis.totalFromTickets || 0;

  const busTravelLocal = fromTickets > 0 ? fromTickets : manualTickets;
  const stayAmount = Math.max(
    voucher.accommodationTotal,
    voucher.dateWiseAccommodationSum || 0,
  );
  const petrolAmount = Math.max(voucher.fuelTotal, manualPetrol);

  const correctTotal = busTravelLocal + petrolAmount + stayAmount;
  const headerParts = voucher.fuelTotal + voucher.ticketsTotal + voucher.accommodationTotal;

  return {
    ...voucher,
    gid,
    imageUrls,
    imageAnalysis: analysis,
    dateBlocks: dateBlocksWithTickets,
    totals: {
      declaredTotal: voucher.declaredTotal,
      headerParts,
      manualDateWiseSum: manualTickets + manualPetrol,
      manualTicketsSum: manualTickets,
      manualPetrolSum: manualPetrol,
      dateWiseAccommodationSum: voucher.dateWiseAccommodationSum,
      dateWiseGrandSum: voucher.dateWiseGrandSum,
      headerTicketsLocal: voucher.ticketsTotal,
      fromTicketImages: fromTickets,
      fuelHeader: voucher.fuelTotal,
      accommodation: stayAmount,
      petrolExpectedFromMap: voucher.mapLegs.reduce((s, leg) => {
        const rate = leg.roundTrip ? 8 : 4;
        return s + (leg.kms || 0) * rate;
      }, 0),
      correctTotal,
      difference: voucher.declaredTotal - correctTotal,
    },
  };
};

export const enrichVoucherWithImages = async (
  voucher,
  tabs,
  spreadsheetId,
  matrix,
  imagesBySheet = null,
) => {
  const gid = voucher.gid || matchTabGid(voucher.sheetName, tabs);
  const cellUrls = extractImageUrlsFromMatrix(matrix);
  const presetImages = imagesBySheet?.[voucher.sheetName] || [];
  const { images: tabImages = [] } = presetImages.length
    ? { images: presetImages }
    : await fetchTabImages(spreadsheetId, gid);
  const cap = travelImageCap(voucher);
  const imageUrls = [...new Set([...cellUrls, ...tabImages])].slice(0, cap);

  let analysis = {
    bills: [],
    tickets: [],
    totalFromTickets: 0,
    imageCount: imageUrls.length,
    note: '',
    provider: '',
    cacheHits: 0,
  };
  if (imageUrls.length > 0) {
    try {
      analysis = await analyzeBillImages(imageUrls, {
        auditorName: voucher.auditorName,
        employeeNo: voucher.employeeNo,
        sheetName: voucher.sheetName,
        voucherMode: voucher.voucherMode,
      });
      if (!analysis.note && analysis.raw) analysis.note = analysis.raw;
    } catch (e) {
      analysis.note = e.message;
    }
  } else {
    analysis.note = 'No bill images found in this tab (paste images in sheet or share as Viewer).';
  }

  return buildEnrichedVoucher(voucher, gid, imageUrls, analysis);
};

export const enrichAllVouchersWithImages = async (
  vouchers,
  tabs,
  spreadsheetId,
  matricesBySheet,
  onProgress,
  options = {},
) => {
  const imagesBySheet = options.imagesBySheet || null;

  onProgress?.(0, vouchers.length, 'Loading bill images from all tabs…');

  let imagesByGid = {};
  if (imagesBySheet) {
    imagesByGid = null;
  } else {
    const gids = vouchers.map((v) => v.gid || matchTabGid(v.sheetName, tabs));
    imagesByGid = await fetchTabImagesBatch(spreadsheetId, gids);
  }

  const batches = vouchers.map((voucher) => {
    const gid = String(voucher.gid || matchTabGid(voucher.sheetName, tabs)).replace(/\D/g, '') || '0';
    const matrix = matricesBySheet[voucher.sheetName] || [];
    const cellUrls = extractImageUrlsFromMatrix(matrix);
    const tabUrls =
      imagesBySheet?.[voucher.sheetName] ||
      imagesByGid?.[gid] ||
      imagesByGid?.[String(gid)] ||
      [];
    const cap = travelImageCap(voucher);
    const imageUrls = [...new Set([...cellUrls, ...tabUrls])].slice(0, cap);
    return {
      key: voucher.sheetName,
      imageUrls,
      context: {
        auditorName: voucher.auditorName,
        employeeNo: voucher.employeeNo,
        sheetName: voucher.sheetName,
        voucherMode: voucher.voucherMode,
      },
      voucher,
      gid,
      matrix,
    };
  });

  const totalImages = batches.reduce((s, b) => s + b.imageUrls.length, 0);
  onProgress?.(0, vouchers.length, `Running Gemini OCR on ${totalImages} bill image(s)…`);

  let byKey = {};
  let bulkTotals = { uniqueImages: 0, cacheHits: 0 };
  try {
    const bulk = await analyzeBillImagesBulk(
      batches.map(({ key, imageUrls, context }) => ({ key, imageUrls, context })),
    );
    byKey = bulk.byKey || {};
    bulkTotals = bulk.totals || bulkTotals;
  } catch (e) {
    byKey = Object.fromEntries(
      batches.map((b) => [
        b.key,
        {
          bills: [],
          tickets: [],
          totalFromTickets: 0,
          imageCount: b.imageUrls.length,
          note: e.message,
          provider: '',
          cacheHits: 0,
        },
      ]),
    );
  }

  const out = batches.map((batch, i) => {
    onProgress?.(i + 1, vouchers.length, batch.voucher.auditorName);
    const analysis =
      byKey[batch.key] ||
      {
        bills: [],
        tickets: [],
        totalFromTickets: 0,
        imageCount: batch.imageUrls.length,
        note: 'No bill images found in this tab (paste images in sheet or share as Viewer).',
        provider: '',
        cacheHits: 0,
      };
    if (!analysis.note && analysis.raw) analysis.note = analysis.raw;
    if (bulkTotals.cacheHits && i === 0 && analysis.raw) {
      analysis.note = `${analysis.raw} · workbook cache hits: ${bulkTotals.cacheHits}`;
    }
    return buildEnrichedVoucher(batch.voucher, batch.gid, batch.imageUrls, analysis);
  });

  const fraudAudit = auditBillsForFraud(out, {
    attendanceRecords: options.attendanceRecords || [],
    pjpRecords: options.pjpRecords || [],
  });
  return attachFraudFlagsToVouchers(out, fraudAudit);
};

export { auditBillsForFraud, attachFraudFlagsToVouchers };
export { parseMoney };
