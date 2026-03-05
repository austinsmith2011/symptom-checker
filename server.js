import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are an expert medical symptom analyzer. Your job is to help users understand what health conditions might explain their symptoms.

IMPORTANT RULES:
- You are NOT a doctor. Always include a disclaimer that this is informational only and not a substitute for professional medical advice.
- Assess emergency/urgency level FIRST. If symptoms suggest a life-threatening condition, say so clearly and urgently.
- Be thorough — consider common AND less common conditions.
- Ask targeted follow-up questions to narrow down the diagnosis.
- Explain things in plain, accessible language (avoid excessive medical jargon).
- When suggesting treatments, distinguish between: home remedies, OTC medications, and things requiring a doctor visit.

You MUST respond with valid JSON matching this exact structure:

{
  "disclaimer": "Brief medical disclaimer string",
  "emergency": {
    "isEmergency": boolean,
    "urgencyLevel": "emergency" | "urgent" | "soon" | "routine",
    "message": "string explaining urgency — if emergency, include clear instructions to call 911 or go to ER"
  },
  "conditions": [
    {
      "name": "Condition Name",
      "likelihood": "high" | "medium" | "low",
      "description": "Brief plain-language description of the condition",
      "whyItMatches": "Explanation of why the user's symptoms match this condition",
      "treatments": {
        "immediate": "What to do right now at home",
        "otc": "Over-the-counter medications that may help",
        "prescription": "Prescription treatments a doctor might recommend",
        "lifestyle": "Lifestyle changes or home remedies"
      },
      "whenToSeeDoctor": "Specific guidance on when professional care is needed",
      "redFlags": ["List of warning signs that mean this is getting serious"]
    }
  ],
  "followUpQuestions": [
    {
      "question": "The question text to ask the user",
      "type": "yes_no" | "choice" | "scale" | "text",
      "options": ["Only for choice type — 2-5 option strings"],
      "scaleMin": "Only for scale type — label for low end",
      "scaleMax": "Only for scale type — label for high end"
    }
  ],
  "summary": "A brief, compassionate 2-3 sentence summary of the overall assessment"
}

Return 3-5 conditions ranked from most to least likely.

FOLLOW-UP QUESTION RULES:
- Return 3-6 follow-up questions that would genuinely help distinguish between possible conditions.
- Choose the right question type for each:
  - "yes_no": Simple yes/no questions (e.g. "Do you have a fever?")
  - "choice": When there are 2-5 specific options (e.g. "What color is the discharge?" with options ["Clear", "Yellow", "Green", "Bloody"])
  - "scale": For rating intensity on a 1-10 scale (provide scaleMin and scaleMax labels)
  - "text": For open-ended questions that need a typed answer (e.g. "What medications have you tried so far?")
- Prefer yes_no and choice types when possible — they're easiest for the user.
- Only include the "options" array for "choice" type questions.
- Only include "scaleMin"/"scaleMax" for "scale" type questions.`;

app.post('/api/analyze', async (req, res) => {
  try {
    const { symptoms, age, sex, height, weight, duration, severity, bodyLocation,
            preExistingConditions, medications, allergies, recentTravel,
            familyHistory, smoking, alcohol, exercise } = req.body;

    let userMessage = `Here are my symptoms and medical information:\n\n`;
    userMessage += `**Primary Symptoms:** ${symptoms}\n`;
    if (age) userMessage += `**Age:** ${age}\n`;
    if (sex) userMessage += `**Sex:** ${sex}\n`;
    if (height) userMessage += `**Height:** ${height}\n`;
    if (weight) userMessage += `**Weight:** ${weight}\n`;
    if (duration) userMessage += `**Duration of symptoms:** ${duration}\n`;
    if (severity) userMessage += `**Severity (1-10):** ${severity}\n`;
    if (bodyLocation) userMessage += `**Body location:** ${bodyLocation}\n`;
    if (preExistingConditions) userMessage += `**Pre-existing conditions:** ${preExistingConditions}\n`;
    if (medications) userMessage += `**Current medications:** ${medications}\n`;
    if (allergies) userMessage += `**Allergies:** ${allergies}\n`;
    if (recentTravel) userMessage += `**Recent travel:** ${recentTravel}\n`;
    if (familyHistory) userMessage += `**Family history:** ${familyHistory}\n`;
    if (smoking) userMessage += `**Smoking:** ${smoking}\n`;
    if (alcohol) userMessage += `**Alcohol use:** ${alcohol}\n`;
    if (exercise) userMessage += `**Exercise level:** ${exercise}\n`;

    userMessage += `\nPlease analyze my symptoms and provide your assessment.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 4000
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json({
      success: true,
      data: result,
      conversationHistory: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
        { role: 'assistant', content: completion.choices[0].message.content }
      ]
    });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to analyze symptoms'
    });
  }
});

app.post('/api/followup', async (req, res) => {
  try {
    const { conversationHistory, message } = req.body;

    if (!conversationHistory || !message) {
      return res.status(400).json({ success: false, error: 'Missing conversation history or message' });
    }

    const messages = [
      ...conversationHistory,
      { role: 'user', content: `Based on this new information, please update your assessment. Respond with the same JSON structure as before.\n\nNew information: ${message}` }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages,
      temperature: 0.3,
      max_tokens: 4000
    });

    const result = JSON.parse(completion.choices[0].message.content);

    const updatedHistory = [
      ...conversationHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: completion.choices[0].message.content }
    ];

    res.json({
      success: true,
      data: result,
      conversationHistory: updatedHistory
    });
  } catch (err) {
    console.error('Follow-up error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to process follow-up'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Symptom Checker running at http://localhost:${PORT}`);
});
