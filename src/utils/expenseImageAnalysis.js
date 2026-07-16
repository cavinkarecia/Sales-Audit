import { fetchTabImages, fetchTabImagesBatch, matchTabGid } from './sheetTabsApi.js';
import {
  auditBillsForFraud,
  attachFraudFlagsToVouchers,
} from './expenseFraudAudit.js';

/** Keep OCR requests under Render's HTTP timeout. */
const MAX_IMAGES_PER_VOUCHER = 4;
const AUDITORS_PER_OCR_CHUNK = 2;

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
  return Math.min(MAX_IMAGES_PER_VOUCHER, Math.max(2, Math.min(travelDays || 2, MAX_IMAGES_PER_VOUCHER)));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const analyzeBillImagesBulkWithRetry = async (batches, attempts = 2) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await analyzeBillImagesBulk(batches);
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const retryable = /failed to fetch|network|timeout|502|503|504/i.test(msg);
      if (!retryable || i === attempts - 1) break;
      await sleep(1200 * (i + 1));
    }
  }
  throw lastErr;
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
    const compareGrand = Number(block.grandTotal) || Number(block.dayTotal) || 0;
    const matches =
      ticketSum > 0
        ? Math.abs(ticketSum - compareAmount) <= 5 ||
          Math.abs(ticketSum - compareSubtotal) <= 5 ||
          (compareGrand > 0 && Math.abs(ticketSum - compareGrand) <= 5)
        : null;

    return {
      ...block,
      ticketsFromImages: matched,
      ticketAmountFromImages: ticketSum,
      manualMatchesImages: matches,
      imageCompareTarget: block.isPetrolDay
        ? compareAmount
        : compareSubtotal || compareGrand || compareAmount,
    };
  });
};

const emptyAnalysis = (imageCount, note = '') => ({
  bills: [],
  tickets: [],
  totalFromTickets: 0,
  imageCount,
  note,
  provider: '',
  cacheHits: 0,
});

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

const resolveImageUrls = async (voucher, tabs, spreadsheetId, matrix, imagesBySheet) => {
  const gid = String(voucher.gid || matchTabGid(voucher.sheetName, tabs)).replace(/\D/g, '') || '0';
  const cellUrls = extractImageUrlsFromMatrix(matrix);
  let tabUrls = imagesBySheet?.[voucher.sheetName] || [];

  if (!tabUrls.length) {
    const batch = await fetchTabImagesBatch(spreadsheetId, [gid]);
    tabUrls = batch?.[gid] || batch?.[String(gid)] || [];
    if (!tabUrls.length) {
      const single = await fetchTabImages(spreadsheetId, gid);
      tabUrls = single.images || [];
    }
  }

  const cap = travelImageCap(voucher);
  const imageUrls = [...new Set([...cellUrls, ...tabUrls])].slice(0, cap);
  return { gid, imageUrls };
};

export const enrichVoucherWithImages = async (
  voucher,
  tabs,
  spreadsheetId,
  matrix,
  imagesBySheet = null,
) => {
  const { gid, imageUrls } = await resolveImageUrls(
    voucher,
    tabs,
    spreadsheetId,
    matrix,
    imagesBySheet,
  );

  let analysis = emptyAnalysis(imageUrls.length);
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

/**
 * OCR in small auditor chunks so each HTTP request finishes before Render/proxy timeout.
 * Sync data still succeeds even if some OCR chunks fail.
 */
export const enrichAllVouchersWithImages = async (
  vouchers,
  tabs,
  spreadsheetId,
  matricesBySheet,
  onProgress,
  options = {},
) => {
  const imagesBySheet = options.imagesBySheet || null;
  const out = [];
  let totalCacheHits = 0;
  let ocrFailures = 0;

  for (let start = 0; start < vouchers.length; start += AUDITORS_PER_OCR_CHUNK) {
    const chunk = vouchers.slice(start, start + AUDITORS_PER_OCR_CHUNK);
    const prepared = [];

    for (const voucher of chunk) {
      const matrix = matricesBySheet[voucher.sheetName] || [];
      onProgress?.(
        out.length + prepared.length + 1,
        vouchers.length,
        `${voucher.auditorName} (loading images)…`,
      );
      try {
        const { gid, imageUrls } = await resolveImageUrls(
          voucher,
          tabs,
          spreadsheetId,
          matrix,
          imagesBySheet,
        );
        prepared.push({
          voucher,
          gid,
          imageUrls,
          key: voucher.sheetName,
          context: {
            auditorName: voucher.auditorName,
            employeeNo: voucher.employeeNo,
            sheetName: voucher.sheetName,
            voucherMode: voucher.voucherMode,
          },
        });
      } catch (e) {
        prepared.push({
          voucher,
          gid: voucher.gid || matchTabGid(voucher.sheetName, tabs),
          imageUrls: [],
          key: voucher.sheetName,
          context: {},
          loadError: e.message,
        });
      }
    }

    const withImages = prepared.filter((p) => p.imageUrls.length > 0);
    let byKey = {};

    if (withImages.length) {
      const names = withImages.map((p) => p.voucher.auditorName).join(', ');
      onProgress?.(
        Math.min(start + chunk.length, vouchers.length),
        vouchers.length,
        `OCR ${names}…`,
      );
      try {
        const bulk = await analyzeBillImagesBulkWithRetry(
          withImages.map(({ key, imageUrls, context }) => ({ key, imageUrls, context })),
        );
        byKey = bulk.byKey || {};
        totalCacheHits += bulk.totals?.cacheHits || 0;
      } catch (e) {
        ocrFailures += withImages.length;
        for (const p of withImages) {
          byKey[p.key] = emptyAnalysis(
            p.imageUrls.length,
            `OCR timed out — retry later (${e.message})`,
          );
        }
      }
    }

    for (const p of prepared) {
      let analysis = byKey[p.key];
      if (!analysis) {
        analysis = emptyAnalysis(
          p.imageUrls.length,
          p.loadError ||
            (p.imageUrls.length
              ? 'OCR skipped'
              : 'No bill images found in this tab (paste images in sheet or share as Viewer).'),
        );
      }
      if (!analysis.note && analysis.raw) analysis.note = analysis.raw;
      out.push(buildEnrichedVoucher(p.voucher, p.gid, p.imageUrls, analysis));
      onProgress?.(out.length, vouchers.length, p.voucher.auditorName);
    }
  }

  if (totalCacheHits > 0 && out[0]?.imageAnalysis) {
    const note = out[0].imageAnalysis.note || out[0].imageAnalysis.raw || '';
    out[0].imageAnalysis.note = `${note} · workbook cache hits: ${totalCacheHits}`.trim();
  }
  if (ocrFailures > 0 && out[0]?.imageAnalysis) {
    out[0].imageAnalysis.note = `${out[0].imageAnalysis.note || ''} · ${ocrFailures} auditor OCR chunk(s) failed`
      .replace(/^\s·\s/, '')
      .trim();
  }

  const fraudAudit = auditBillsForFraud(out, {
    attendanceRecords: options.attendanceRecords || [],
    pjpRecords: options.pjpRecords || [],
  });
  return attachFraudFlagsToVouchers(out, fraudAudit);
};

export { auditBillsForFraud, attachFraudFlagsToVouchers };
export { parseMoney };
