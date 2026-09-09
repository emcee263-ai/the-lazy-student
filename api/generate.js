const MODEL = "gemini-3.6-flash";

const API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_INPUT = 18000;
const MIN_INPUT = 40;


/* ============================================================
   SLEEP
============================================================ */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/* ============================================================
   GEMINI REQUEST WITH RETRIES
============================================================ */

async function callGemini(apiKey, body) {

  const maxAttempts = 4;

  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {

    try {

      const response = await fetch(API_URL, {

        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },

        body: JSON.stringify(body)

      });

      const data = await response.json();

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
          `Gemini request failed with status ${response.status}.`
        );
      }

      lastError =
        data?.error?.message ||
        `Gemini temporarily returned ${response.status}.`;

      /*
        Exponential backoff + jitter.

        Attempt 1: roughly 1s
        Attempt 2: roughly 2s
        Attempt 3: roughly 4s
        Attempt 4: roughly 8s
      */

      if (attempt < maxAttempts - 1) {

        const baseDelay =
          Math.min(
            8000,
            1000 * Math.pow(2, attempt)
          );

        const jitter =
          Math.floor(Math.random() * 700);

        await sleep(baseDelay + jitter);
      }

    } catch (error) {

      lastError = error;

      if (attempt === maxAttempts - 1) {
        throw error;
      }

      const baseDelay =
        Math.min(
          8000,
          1000 * Math.pow(2, attempt)
        );

      const jitter =
        Math.floor(Math.random() * 700);

      await sleep(baseDelay + jitter);
    }
  }

  throw new Error(
    lastError?.message ||
    "Gemini is temporarily unavailable."
  );
}


/* ============================================================
   JSON SCHEMA
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

          /*
            THIS IS THE IMPORTANT FIX.

            The answer is an integer index.

            Example:

            options:
            [
              "A",
              "B",
              "C",
              "D"
            ]

            answer: 2

            means "C" is correct.
          */

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
   API HANDLER
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

    if (text.length < MIN_INPUT) {

      return res.status(400).json({
        error:
          `Please provide at least ${MIN_INPUT} characters of study material.`
      });
    }

    if (text.length > MAX_INPUT) {

      return res.status(400).json({
        error:
          `Your study material is too long. Please keep it under ${MAX_INPUT} characters.`
      });
    }


    /* ========================================================
       PROMPT
    ======================================================== */

    const prompt = `You are "The Lazy Student", an expert study-guide generator.

Your job is to transform the supplied study material into a concise,
accurate, memorable study guide.

Do not invent facts that are not supported by the source material.

Return:
1. A clear summary.
2. Important key points.
3. Useful flashcards.
4. Real-world examples.
5. A short multiple-choice quiz.

QUIZ RULES — VERY IMPORTANT:

Every quiz question must have exactly 4 options.

The "answer" field MUST be an INTEGER from 0 to 3.

It represents the ZERO-BASED INDEX of the correct option.

For example:

options:
[
  "Paris",
  "London",
  "Rome",
  "Madrid"
]

If Paris is correct, return:

"answer": 0

If Rome is correct, return:

"answer": 2

NEVER return the answer text.

NEVER return "A", "B", "C", or "D".

NEVER return an explanation as the answer.

The answer field must ONLY be an integer between 0 and 3.

Make the wrong options plausible but clearly distinguishable from the
correct answer using the source material.

Create between 5 and 8 quiz questions.

Create between 5 and 10 key points.

Create between 5 and 10 flashcards.

Create between 3 and 5 real-world examples.

Keep the language clear and useful rather than academic or bloated.

SOURCE MATERIAL:

${text}`;


    /* ========================================================
       REQUEST
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

        responseMimeType: "application/json",

        responseSchema,

        temperature: 0.55,

        maxOutputTokens: 7000

      }

    };


    const data =
      await callGemini(apiKey, body);


    /* ========================================================
       EXTRACT GEMINI TEXT
    ======================================================== */

    const generatedText =
      data?.candidates?.[0]?.content?.parts
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

    } catch (error) {

      console.error(
        "Invalid Gemini JSON:",
        generatedText
      );

      throw new Error(
        "Gemini returned invalid study-guide data."
      );
    }


    /* ========================================================
       SERVER-SIDE QUIZ VALIDATION
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
          "A quiz question did not contain exactly four options."
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
          "Gemini returned an invalid quiz answer index."
        );
      }

      question.answer = answer;
    }


    /* ========================================================
       RETURN CLEAN JSON
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
