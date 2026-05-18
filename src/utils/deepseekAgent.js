/**
 * DeepSeek AI Agent utility for Sales Audit travel data analysis.
 * Uses the client-provided DeepSeek API key.
 */

const DEEPSEEK_API_KEY = "sk-39c306e5700c4b169958cd4a16ddbad2";
const API_URL = "https://api.deepseek.com/chat/completions";

/**
 * Call the DeepSeek Chat Completions API with a prompt
 */
const callDeepSeek = async (prompt, systemInstruction = "You are an expert field sales operations assistant.") => {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error (HTTP ${response.status}): ${errorText}`);
    }

    const result = await response.json();
    return result.choices[0].message.content;
  } catch (error) {
    console.error("DeepSeek API call failed:", error);
    throw error;
  }
};

/**
 * Generates an AI Travel Audit Analysis for a selected auditor and month
 * 
 * @param {string} auditorName 
 * @param {string} monthLabel 
 * @param {Array} records 
 * @param {Object} stats 
 * @returns {Promise<string>} - AI Analysis text
 */
export const getAIInsights = async (auditorName, monthLabel, records, stats) => {
  // Minimize the prompt size to only necessary data
  const travelSummary = records.map(r => ({
    date: r.date,
    from: r.fromTown || 'N/A',
    to: r.toTown || 'N/A',
    kms: r.kms || 0,
    workType: r.workType || 'N/A',
    plannedRS: r.plannedRSName || 'N/A'
  })).slice(0, 31); // Cap at 31 records for a month

  const prompt = `
Analyze the travel footprint and audit performance of Sales Auditor: **${auditorName}** for the period: **${monthLabel}**.

### Context Summary:
- **Base Location:** ${stats.baseLocation}
- **Total Days in Log:** ${stats.totalDays}
- **Market Visit Days:** ${stats.workingDays}
- **Leave/Off Days:** ${stats.leaveDays}
- **Total Kms Travelled:** ${stats.totalKms} km
- **Unique Towns Visited:** ${stats.townsVisited} (${stats.townsList.join(', ')})

### Travel Log Details (Date, From, To, Kms, WorkType, PlannedRS):
${JSON.stringify(travelSummary, null, 2)}

Provide a concise, professional assessment containing:
1. **Travel Strategy & Efficiency:** (Compare Base Location with Towns Visited. Are the travel patterns efficient? Any excessive/unexplained travel?)
2. **Coverage Quality:** (Did they cover planned retail stores? Any noticeable gaps?)
3. **Key Recommendation:** (One actionable recommendation for route planning or productivity optimization).

Keep the summary professional, clear, and highly focused (under 250 words total). Use clean markdown formatting.
`;

  return await callDeepSeek(prompt, "You are an elite Retail Audit Operations Analyst evaluating field force travel efficiency.");
};

/**
 * Automatically evaluates all auditors' data to flag anomalous travel distances
 */
export const analyzeAllAuditorsTravel = async (groupedRecords, auditorsMaster) => {
  const summaries = Object.keys(groupedRecords).map(name => {
    const records = groupedRecords[name];
    const totalKms = records.reduce((sum, r) => sum + (r.kms || 0), 0);
    const master = auditorsMaster.find(a => a.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(a.name.toLowerCase()));
    
    return {
      name,
      base: master ? master.location : 'Unknown',
      totalKms: Math.round(totalKms),
      recordCount: records.length
    };
  });

  const prompt = `
Analyze the monthly travel telemetry of the following Sales Audit team members:
${JSON.stringify(summaries, null, 2)}

Provide a short executive summary (max 150 words):
- Highlight the top 3 highest travellers.
- Identify if any travel looks excessively high or low (e.g., travellers with 0 travel or > 2000 kms).
- Actionable suggestion for the supervisor.
`;

  return await callDeepSeek(prompt, "You are a regional Field Force Operations Supervisor.");
};
