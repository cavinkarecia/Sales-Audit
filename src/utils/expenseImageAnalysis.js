import { fetchTabImages, matchTabGid } from './sheetTabsApi.js';
import {
  auditBillsForFraud,
  attachFraudFlagsToVouchers,
} from './expenseFraudAudit.js';

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

export const analyzeBillImages = async (imageUrls, context = {}) => {
  if (!imageUrls?.length) {
    return { bills: [], tickets: [], totalFromTickets: 0, imageCount: 0, raw: '' };
  }
  const res = await fetch('/api/ai/analyze-bill-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrls: imageUrls.slice(0, 24), context }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Image analysis failed (HTTP ${res.status})`);
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
  const imageUrls = [...new Set([...cellUrls, ...tabImages])];

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
  for (let i = 0; i < vouchers.length; i++) {
    const v = vouchers[i];
    const matrix = matricesBySheet[v.sheetName] || [];
    onProgress?.(i + 1, vouchers.length, v.auditorName);
    out.push(
      await enrichVoucherWithImages(v, tabs, spreadsheetId, matrix, imagesBySheet),
    );
  }

  const fraudAudit = auditBillsForFraud(out, {
    attendanceRecords: options.attendanceRecords || [],
    pjpRecords: options.pjpRecords || [],
  });
  return attachFraudFlagsToVouchers(out, fraudAudit);
};

export { auditBillsForFraud, attachFraudFlagsToVouchers };
export { parseMoney };
