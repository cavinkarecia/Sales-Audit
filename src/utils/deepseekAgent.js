/**
 * AI agent — calls backend proxy (DEEPSEEK_API_KEY on server only).
 */

const callAi = async (prompt, systemInstruction) => {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, systemInstruction }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `AI request failed (HTTP ${response.status})`);
  }
  const data = await response.json();
  return data.content;
};

export const getAIInsights = async (auditorName, monthLabel, records, stats) => {
  const travelSummary = records
    .map((r) => ({
      date: r.date,
      from: r.fromTown || 'N/A',
      to: r.toTown || 'N/A',
      kms: r.kms || 0,
      workType: r.workType || 'N/A',
      plannedRS: r.plannedRSName || 'N/A',
    }))
    .slice(0, 31);

  const prompt = `
Analyze travel for auditor **${auditorName}**, period **${monthLabel}**.
Base: ${stats.baseLocation} | Days: ${stats.totalDays} | Working: ${stats.workingDays} | Kms: ${stats.totalKms}
Towns: ${stats.townsList.join(', ')}
Log: ${JSON.stringify(travelSummary, null, 2)}
Concise assessment (<250 words): efficiency, coverage, one recommendation. Markdown.
`;

  return callAi(
    prompt,
    'You are an elite Retail Audit Operations Analyst evaluating field force travel efficiency.',
  );
};

export const analyzeAllAuditorsTravel = async (groupedRecords, auditorsMaster) => {
  const summaries = Object.keys(groupedRecords).map((name) => {
    const records = groupedRecords[name];
    const totalKms = records.reduce((sum, r) => sum + (r.kms || 0), 0);
    const master = auditorsMaster.find(
      (a) =>
        a.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(a.name.toLowerCase()),
    );
    return {
      name,
      base: master ? master.location : 'Unknown',
      totalKms: Math.round(totalKms),
      recordCount: records.length,
    };
  });

  return callAi(
    `Team travel telemetry:\n${JSON.stringify(summaries, null, 2)}\nExecutive summary (150 words): top travellers, anomalies, one action.`,
    'You are a regional Field Force Operations Supervisor.',
  );
};
