import { fetchTabImages, matchTabGid } from './sheetTabsApi.js';

const parseMoney = (val) => {
  const n = parseFloat(String(val ?? '').replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

/** IMAGE() formula and direct image URLs in cells. */
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
  if (!imageUrls?.length) return { tickets: [], totalFromTickets: 0, raw: '' };
  const res = await fetch('/api/ai/analyze-bill-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrls: imageUrls.slice(0, 8), context }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Image analysis failed (HTTP ${res.status})`);
  }
  return res.json();
};

const normDate = (d) => String(d || '').replace(/[^0-9]/g, '');

export const attachTicketAnalysisToDates = (dateBlocks, tickets) => {
  return dateBlocks.map((block) => {
    const blockKey = normDate(block.date);
    const matched = tickets.filter((t) => {
      const tk = normDate(t.date);
      return tk && blockKey && (tk.includes(blockKey.slice(-6)) || blockKey.includes(tk.slice(-6)));
    });
    const ticketSum = matched.reduce((s, t) => s + (t.amount || 0), 0);
    const allTickets = tickets.length ? tickets : [];
    return {
      ...block,
      ticketsFromImages: matched,
      ticketAmountFromImages: ticketSum,
      manualMatchesImages:
        ticketSum > 0 ? Math.abs(ticketSum - block.grandTotal) <= 5 : null,
    };
  });
};

export const enrichVoucherWithImages = async (voucher, tabs, spreadsheetId, matrix) => {
  const gid = matchTabGid(voucher.sheetName, tabs);
  const cellUrls = extractImageUrlsFromMatrix(matrix);
  const { images: htmlImages = [] } = await fetchTabImages(spreadsheetId, gid);
  const imageUrls = [...new Set([...cellUrls, ...htmlImages])];

  let analysis = { tickets: [], totalFromTickets: 0, imageCount: imageUrls.length, note: '' };
  if (imageUrls.length > 0) {
    try {
      analysis = await analyzeBillImages(imageUrls, {
        auditorName: voucher.auditorName,
        employeeNo: voucher.employeeNo,
        sheetName: voucher.sheetName,
      });
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

  const manualBusTrain = voucher.dateWiseBusTrainSum;
  const fromTickets = analysis.totalFromTickets || 0;
  const correctBusTrain = fromTickets > 0 ? fromTickets : manualBusTrain;

  const petrolExpected = voucher.mapLegs.reduce((s, leg) => {
    const rate = leg.roundTrip ? 8 : 4;
    return s + (leg.kms || 0) * rate;
  }, 0);

  const correctTotal =
    correctBusTrain + voucher.accommodationTotal + (voucher.fuelTotal > 0 ? voucher.fuelTotal : 0);

  return {
    ...voucher,
    gid,
    imageUrls,
    imageAnalysis: analysis,
    dateBlocks: dateBlocksWithTickets,
    totals: {
      declaredTotal: voucher.declaredTotal,
      manualDateWiseSum: manualBusTrain,
      headerTicketsLocal: voucher.ticketsTotal,
      fromTicketImages: fromTickets,
      fuelHeader: voucher.fuelTotal,
      accommodation: voucher.accommodationTotal,
      petrolExpectedFromMap: petrolExpected,
      correctTotal,
      difference: voucher.declaredTotal - correctTotal,
    },
  };
};

export const enrichAllVouchersWithImages = async (vouchers, tabs, spreadsheetId, matricesBySheet) => {
  const out = [];
  for (const v of vouchers) {
    const matrix = matricesBySheet[v.sheetName] || [];
    out.push(await enrichVoucherWithImages(v, tabs, spreadsheetId, matrix));
  }
  return out;
};
