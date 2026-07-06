import { PETROL_KM_RATE } from './expenseVoucherParser.js';

export const PETROL_ROUND_RATE = 8;

export const petrolRateForDay = (day) =>
  day?.isRoundTrip ? PETROL_ROUND_RATE : PETROL_KM_RATE;

export const expectedPetrolForDay = (day) => {
  const entered = day?.petrolTravel || 0;
  if (!day?.kmTraveled || day.kmTraveled <= 0) return entered;
  const rate = petrolRateForDay(day);
  return day.kmCalcAmount || Math.round(day.kmTraveled * rate);
};

/** Per-day split: Travel (tickets), Local allowance, Petrol, Stay. */
export const analyzeExpenseDay = (day) => {
  const travel = day.travel || 0;
  const local = day.localConveyance || 0;
  const stay = day.accommodation || 0;
  const petrolEntered = day.petrolTravel || 0;

  const isPetrol =
    day.isPetrolDay || day.isKmPetrolDay || day.splitType === 'petrol' || day.splitType === 'petrol_km';
  const isDa = day.splitType === 'da' || day.isDaOnly;
  const isBus =
    !isDa &&
    (day.hasBusTrainHint ||
      day.splitType === 'bus_train' ||
      day.splitType === 'mixed' ||
      travel > 0 ||
      local > 0);

  let petrolCheck = '—';
  let petrolExpected = petrolEntered;
  let petrolMatch = true;

  if (day.kmTraveled > 0 && (isPetrol || petrolEntered > 0)) {
    const rate = petrolRateForDay(day);
    petrolExpected = expectedPetrolForDay(day);
    const kmStr =
      day.kmLegs?.length > 1
        ? `${day.kmLegs.join('+')}=${day.kmTraveled}`
        : `${day.kmTraveled}`;
    petrolCheck = day.isRoundTrip
      ? `${kmStr} km × ₹8 = ₹${petrolExpected}`
      : `${kmStr} km × ₹4 = ₹${petrolExpected}`;
    petrolMatch = petrolEntered <= 0 || Math.abs(petrolEntered - petrolExpected) <= 5;
  } else if (isPetrol && petrolEntered > 0) {
    petrolCheck = `Petrol entered ₹${petrolEntered}`;
    petrolMatch = true;
  }

  const daySplitTotal = travel + local + petrolEntered + stay;
  const sheetGrand = day.grandTotal || 0;

  let rowCheck = '';
  let rowExpected = daySplitTotal;

  if (isPetrol && !isBus) {
    rowExpected = petrolEntered + stay;
    rowCheck = stay > 0 ? 'Petrol + Stay' : 'Petrol only';
  } else if (isDa) {
    rowExpected = 0;
    rowCheck = 'DA only — ₹0';
  } else if (isBus) {
    rowExpected = travel + local + stay + (petrolEntered > 0 ? petrolEntered : 0);
    rowCheck =
      stay > 0
        ? 'Travel (tickets) + Local allowance + Stay'
        : 'Travel (tickets) + Local allowance';
    if (petrolEntered > 0) rowCheck += ' + Petrol';
  } else if (stay > 0) {
    rowExpected = stay;
    rowCheck = 'Stay only';
  } else {
    rowCheck = '—';
  }

  const grandMatch =
    sheetGrand <= 0 || Math.abs(sheetGrand - rowExpected) <= 5 || Math.abs(sheetGrand - daySplitTotal) <= 5;
  const splitMatch = Math.abs(daySplitTotal - rowExpected) <= 5 || (!isBus && isPetrol);

  const ok = isDa
    ? true
    : petrolMatch && grandMatch && (splitMatch || daySplitTotal > 0);

  return {
    travel,
    local,
    stay,
    petrolEntered,
    petrolExpected,
    petrolCheck,
    petrolMatch,
    daySplitTotal,
    sheetGrand,
    rowCheck,
    rowExpected,
    grandMatch,
    ok,
    isDa,
    isBus,
    isPetrol,
  };
};

export const sumDaySplits = (days) =>
  (days || []).reduce(
    (acc, d) => {
      const a = analyzeExpenseDay(d);
      return {
        travel: acc.travel + a.travel,
        local: acc.local + a.local,
        petrol: acc.petrol + a.petrolEntered,
        stay: acc.stay + a.stay,
        ticketsLocal: acc.ticketsLocal + (a.isBus ? a.travel + a.local : 0),
        daySplitTotal: acc.daySplitTotal + a.daySplitTotal,
      };
    },
    { travel: 0, local: 0, petrol: 0, stay: 0, ticketsLocal: 0, daySplitTotal: 0 },
  );
