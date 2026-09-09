export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { text } = req.body || {};

    // Validate the submitted notes
    if (!text || typeof text !== "string") {
      return res.status(400).json({
        error: "No study material was provided."
      });
    }

    if (text.trim().length < 40) {
      return res.status(400).json({
        error: "Please provide at least 40 characters of study material."
      });
    }

    if (text.length > 18000) {
      return res.status(400).json({
        error: "Study material is too long. Please keep it under 18,000 characters."
      });
    }

    const prompt = `
You are the AI study companion for an app called "The Lazy Student".

Turn the following study material into a concise, memorable study guide.

Return ONLY valid JSON matching the requested schema.

Rules:
- Keep explanations simple and useful.
- Do not invent facts that aren't supported by the source material.
- Make flashcards useful for active recall.
- Make quiz questions test understanding, not obscure details.
- Give practical real-world examples when possible.

STUDY MATERIAL:

${text}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],

          generationConfig: {
            responseMimeType: "application/json",

            responseSchema: {
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
                      }
                    },
                    required: [
                      "concept",
                      "example"
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
                        type: "STRING"
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
            }
          }
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", result);

      return res.status(response.status).json({
        error: result?.error?.message || "Gemini API request failed."
      });
    }

    const generatedText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      return res.status(500).json({
        error: "Gemini returned an empty response."
      });
    }

    let data;

    try {
      data = JSON.parse(generatedText);
    } catch (error) {
      console.error("JSON parsing error:", error);
      console.error("Gemini response:", generatedText);

      return res.status(500).json({
        error: "The AI returned an invalid response."
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      error: "Something went wrong while generating your study guide."
    });
  }
}
