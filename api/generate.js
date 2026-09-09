const MODEL = "gemini-3.6-flash";

const API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_INPUT = 18000;
const MIN_INPUT = 40;


/* ============================================================
   MODE SETTINGS
============================================================ */

const MODES = {

  quick: {
    name: "Quick",
    keyPoints: 5,
    flashcards: 5,
    examples: 3,
    quiz: 5,
    maxOutputTokens: 4500,

    instruction: `
Keep everything concise.

Prioritize the most important information only.
The user wants a fast revision session.

Use short explanations and avoid unnecessary detail.
`
  },

  standard: {
    name: "Standard",
    keyPoints: 7,
    flashcards: 7,
    examples: 4,
    quiz: 6,
    maxOutputTokens: 6000,

    instruction: `
Create a balanced study guide.

Explain important ideas clearly without becoming unnecessarily long.
Focus on what a student is most likely to need to understand and remember.
`
  },

  deep: {
    name: "Deep",
    keyPoints: 10,
    flashcards: 10,
    examples: 5,
    quiz: 8,
    maxOutputTokens: 8000,

    instruction: `
Create a comprehensive study guide.

Cover the important concepts thoroughly.
Explain relationships between ideas and include useful context.

Do not add facts that aren't supported by the source material.
`
  }

};


/* ============================================================
   SLEEP
============================================================ */

function sleep(ms) {

  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });

}


/* ============================================================
   GEMINI REQUEST
============================================================ */

async function callGemini(apiKey, body) {

  const maxAttempts = 4;

  let lastError = null;

  for (
    let attempt = 0;
    attempt < maxAttempts;
    attempt++
  ) {

    try {

      const response = await fetch(
        API_URL,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },

          body: JSON.stringify(body)
        }
      );

      const data =
        await response.json();


      if (response.ok) {
        return data;
      }


      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;


      if (!retryable) {

        throw new Error(
          data?.error?.message ||
          `Gemini returned ${response.status}.`
        );

      }


      lastError =
        data?.error?.message ||
        `Gemini temporarily returned ${response.status}.`;


      if (attempt < maxAttempts - 1) {

        const delay =
          Math.min(
            8000,
            1000 * Math.pow(2, attempt)
          )
          +
          Math.floor(
            Math.random() * 700
          );

        await sleep(delay);
      }


    } catch (error) {

      lastError = error;

      if (attempt === maxAttempts - 1) {
        throw error;
      }

      const delay =
        Math.min(
          8000,
          1000 * Math.pow(2, attempt)
        )
        +
        Math.floor(
          Math.random() * 700
        );

      await sleep(delay);
    }

  }

  throw new Error(
    lastError?.message ||
    "Gemini is temporarily unavailable."
  );
}


/* ============================================================
   SCHEMA
============================================================ */

const responseSchema = {

  type: "OBJECT",

  properties: {

    summary: {
      type: "STRING"
    },

    keyPoints: {

      type: "ARRAY",

      items: {
        type: "STRING"
      }

    },

    flashcards: {

      type: "ARRAY",

      items: {

        type: "OBJECT",

        properties: {

          question: {
            type: "STRING"
          },

          answer: {
            type: "STRING"
          }

        },

        required: [
          "question",
          "answer"
        ]

      }

    },

    examples: {

      type: "ARRAY",

      items: {

        type: "OBJECT",

        properties: {

          concept: {
            type: "STRING"
          },

          example: {
            type: "STRING"
          },

          whyItMatters: {
            type: "STRING"
          }

        },

        required: [
          "concept",
          "example",
          "whyItMatters"
        ]

      }

    },

    quiz: {

      type: "ARRAY",

      items: {

        type: "OBJECT",

        properties: {

          question: {
            type: "STRING"
          },

          options: {

            type: "ARRAY",

            items: {
              type: "STRING"
            }
          },

          answer: {

            type: "INTEGER",

            minimum: 0,

            maximum: 3
          },

          explanation: {
            type: "STRING"
          }

        },

        required: [
          "question",
          "options",
          "answer",
          "explanation"
        ]

      }

    }

  },

  required: [
    "summary",
    "keyPoints",
    "flashcards",
    "examples",
    "quiz"
  ]

};


/* ============================================================
   HANDLER
============================================================ */

export default async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({
      error: "Method not allowed."
    });

  }


  const apiKey =
    process.env.GEMINI_API_KEY;


  if (!apiKey) {

    return res.status(500).json({
      error:
        "GEMINI_API_KEY is not configured in Vercel."
    });

  }


  try {

    const text =
      typeof req.body?.text === "string"
        ? req.body.text.trim()
        : "";


    let mode =
      typeof req.body?.mode === "string"
        ? req.body.mode
        : "standard";


    /*
      Prevent the browser from sending an
      arbitrary mode value.
    */

    if (!MODES[mode]) {
      mode = "standard";
    }


    const settings =
      MODES[mode];


    /* ========================================================
       VALIDATE INPUT
    ======================================================== */

    if (text.length < MIN_INPUT) {

      return res.status(400).json({
        error:
          `Please provide at least ${MIN_INPUT} characters of study material.`
      });

    }


    if (text.length > MAX_INPUT) {

      return res.status(400).json({
        error:
          `Please keep your study material under ${MAX_INPUT} characters.`
      });

    }


    /* ========================================================
       PROMPT
    ======================================================== */

    const prompt = `You are "The Lazy Student", an expert study-guide generator.

The student selected STUDY MODE: ${settings.name}.

${settings.instruction}

Create:

- exactly one concise but useful summary
- approximately ${settings.keyPoints} key points
- approximately ${settings.flashcards} flashcards
- approximately ${settings.examples} real-world examples
- exactly ${settings.quiz} quiz questions

QUIZ REQUIREMENTS — EXTREMELY IMPORTANT:

Every quiz question must contain EXACTLY 4 options.

The "answer" field must be an INTEGER from 0 to 3.

It is the ZERO-BASED INDEX of the correct option.

Example:

options:
[
  "Paris",
  "London",
  "Rome",
  "Madrid"
]

If Paris is correct:

"answer": 0

If Rome is correct:

"answer": 2

NEVER return the answer text.

NEVER return "A", "B", "C", or "D".

NEVER return a sentence as the answer.

The answer must ONLY be an integer between 0 and 3.

The quiz must test understanding rather than obscure trivia.

Wrong answers should be plausible.

The explanation should briefly explain why the correct answer is correct.

IMPORTANT ACCURACY RULE:

Use only information supported by the supplied study material.
Do not hallucinate additional facts.

SOURCE MATERIAL:

${text}`;


    /* ========================================================
       GEMINI REQUEST
    ======================================================== */

    const body = {

      contents: [

        {
          role: "user",

          parts: [
            {
              text: prompt
            }
          ]
        }

      ],

      generationConfig: {

        responseMimeType:
          "application/json",

        responseSchema,

        temperature: 0.55,

        maxOutputTokens:
          settings.maxOutputTokens

      }

    };


    const data =
      await callGemini(
        apiKey,
        body
      );


    /* ========================================================
       GET GENERATED TEXT
    ======================================================== */

    const generatedText =
      data
        ?.candidates?.[0]
        ?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();


    if (!generatedText) {

      throw new Error(
        "Gemini returned an empty response."
      );

    }


    /* ========================================================
       PARSE JSON
    ======================================================== */

    let result;

    try {

      result =
        JSON.parse(generatedText);

    } catch {

      console.error(
        "Invalid Gemini response:",
        generatedText
      );

      throw new Error(
        "Gemini returned invalid study-guide data."
      );

    }


    /* ========================================================
       VALIDATE QUIZ
    ======================================================== */

    if (!Array.isArray(result.quiz)) {

      throw new Error(
        "Gemini returned an invalid quiz."
      );

    }


    for (const question of result.quiz) {

      if (!Array.isArray(question.options)) {

        throw new Error(
          "A quiz question has invalid options."
        );

      }


      if (question.options.length !== 4) {

        throw new Error(
          "A quiz question must have exactly four options."
        );

      }


      const answer =
        Number(question.answer);


      if (
        !Number.isInteger(answer) ||
        answer < 0 ||
        answer > 3
      ) {

        throw new Error(
          "Gemini returned an invalid quiz answer."
        );

      }


      question.answer = answer;

    }


    /* ========================================================
       RETURN
    ======================================================== */

    return res.status(200).json(result);

  } catch (error) {

    console.error(
      "Study guide generation error:",
      error
    );


    return res.status(500).json({

      error:
        error?.message ||
        "Gemini is temporarily unavailable. Please try again."

    });

  }

}
