import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import twilio from "twilio";
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config();

const { 
  ELEVENLABS_AGENT_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  NGROK_URL
} = process.env;

// Check for required environment variables
if (!ELEVENLABS_AGENT_ID || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
  console.error("Missing required environment variables");
  process.exit(1);
}

// Initialize Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Initialize Fastify server
const fastify = Fastify({
  logger: true // Add logging for better debugging
});

// Register plugins
await fastify.register(fastifyFormBody);
await fastify.register(fastifyWs);

const PORT = process.env.PORT || 8000;

// Root route for health check
fastify.get("/", async (_, reply) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Make Call</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 5px;
        }
        input[type="tel"] {
            width: 100%;
            padding: 8px;
            font-size: 16px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        button {
            background-color: #4CAF50;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
        }
        button:hover {
            background-color: #45a049;
        }
        .status {
            margin-top: 20px;
            padding: 10px;
            border-radius: 4px;
        }
        .success {
            background-color: #dff0d8;
            color: #3c763d;
        }
        .error {
            background-color: #f2dede;
            color: #a94442;
        }
    </style>
</head>
<body>
    <h1>Make a Call</h1>
    <div class="form-group">
        <label for="phoneNumber">Phone Number:</label>
        <input type="tel" id="phoneNumber" placeholder="+1234567890" required>
    </div>
    <button onclick="makeCall()">Make Call</button>
    <div id="status" class="status" style="display: none;"></div>

    <script>
        async function makeCall() {
            const phoneNumber = document.getElementById('phoneNumber').value;
            const statusDiv = document.getElementById('status');

            try {
                const response = await fetch('/make-call', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ phoneNumber }),
                });

                const data = await response.json();

                if (response.ok) {
                    statusDiv.className = 'status success';
                    statusDiv.textContent = \`Call initiated successfully! Call SID: \${data.callSid}\`;
                } else {
                    statusDiv.className = 'status error';
                    statusDiv.textContent = data.error || 'Failed to make call';
                }
            } catch (error) {
                statusDiv.className = 'status error';
                statusDiv.textContent = 'Error: Could not connect to server';
            }

            statusDiv.style.display = 'block';
        }
    </script>
</body>
</html>
  `;

  reply.type('text/html').send(html);
});

// Add new endpoint to initiate calls
fastify.post("/make-call", async (request, reply) => {
  try {
    const { phoneNumber } = request.body;
    if (!phoneNumber) {
      return reply.status(400).send({ error: "Phone number is required" });
    }

    const call = await makeOutboundCall(phoneNumber);
    return reply.send({ success: true, callSid: call.sid });
  } catch (error) {
    console.error("Error in /make-call endpoint:", error);
    return reply.status(500).send({ error: "Failed to initiate call" });
  }
});

// Add the makeOutboundCall function
async function makeOutboundCall(targetNumber) {
  try {
    const call = await twilioClient.calls.create({
      from: TWILIO_PHONE_NUMBER,
      to: targetNumber,
      url: `https://${NGROK_URL}/incoming-call-eleven`,
      statusCallback: `https://${NGROK_URL}/call-status`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    });

    console.log(`Initiated call with SID: ${call.sid}`);
    return call;
  } catch (error) {
    console.error("Error making outbound call:", error);
    throw error;
  }
}

// Add endpoint to handle call status callbacks
fastify.post("/call-status", async (request, reply) => {
  const { CallSid, CallStatus } = request.body;
  console.log(`Call ${CallSid} status updated to: ${CallStatus}`);
  reply.send({ success: true });
});

// Route to handle incoming calls from Twilio
fastify.all("/incoming-call-eleven", async (request, reply) => {
  // Generate TwiML response to connect the call to a WebSocket stream
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
      </Connect>
    </Response>`;

  reply.type("text/xml").send(twimlResponse);
});

// WebSocket route for handling media streams from Twilio
fastify.register(async (fastifyInstance) => {
  fastifyInstance.get("/media-stream", { websocket: true }, (connection, req) => {
    console.info("[Server] Twilio connected to media stream.");

    let streamSid = null;

    // Connect to ElevenLabs Conversational AI WebSocket with proper headers
    const wsUrl = new URL(`wss://api.elevenlabs.io/v1/convai/conversation`);
    wsUrl.searchParams.append('agent_id', ELEVENLABS_AGENT_ID);

    const elevenLabsWs = new WebSocket(wsUrl.toString(), {
      headers: {
        "Accept": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json"
      }
    });

    // Handle open event for ElevenLabs WebSocket
    elevenLabsWs.on("open", () => {
      console.log("[ElevenLabs] Connected to Conversational AI.");
      
      // Send initial configuration
      const initConfig = {
        text: " ", // Initial empty text
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          use_speaker_boost: false
        },
        generation_config: {
          chunk_length_schedule: [120, 160, 250, 290]
        }
      };
      elevenLabsWs.send(JSON.stringify(initConfig));
    });

    // Handle messages from ElevenLabs
    elevenLabsWs.on("message", (data) => {
      try {
        const message = JSON.parse(data);
        console.log("[ElevenLabs] Received message type:", message.type);
        
        switch (message.type) {
          case "conversation_initiation_metadata":
            console.info("[ElevenLabs] Conversation initiated");
            break;

          case "audio":
            if (message.audio_event?.audio_base_64) {
              // Send audio data to Twilio
              const audioData = {
                event: "media",
                streamSid,
                media: {
                  payload: message.audio_event.audio_base_64,
                },
              };
              connection.send(JSON.stringify(audioData));
            }
            break;

          case "interruption":
            // Clear Twilio's audio queue
            connection.send(JSON.stringify({ event: "clear", streamSid }));
            break;

          case "ping":
            // Respond to ping events
            if (message.ping_event?.event_id) {
              const pongResponse = {
                type: "pong",
                event_id: message.ping_event.event_id,
              };
              elevenLabsWs.send(JSON.stringify(pongResponse));
            }
            break;

          default:
            console.log(`[ElevenLabs] Unhandled message type: ${message.type}`);
        }
      } catch (error) {
        console.error("[ElevenLabs] Error processing message:", error);
      }
    });

    // Handle messages from Twilio
    connection.on("message", async (message) => {
      try {
        const data = JSON.parse(message);
        
        switch (data.event) {
          case "start":
            streamSid = data.start.streamSid;
            console.log(`[Twilio] Stream started with ID: ${streamSid}`);
            break;

          case "media":
            // Route audio from Twilio to ElevenLabs
            if (elevenLabsWs.readyState === WebSocket.OPEN) {
              const audioMessage = {
                user_audio_chunk: Buffer.from(data.media.payload, "base64").toString("base64"),
              };
              elevenLabsWs.send(JSON.stringify(audioMessage));
            }
            break;

          case "stop":
            console.log("[Twilio] Stream stopped");
            elevenLabsWs.close();
            break;
        }
      } catch (error) {
        console.error("[Twilio] Error processing message:", error);
      }
    });

    // Handle WebSocket closure and errors
    connection.on("close", () => {
      console.log("[Twilio] Connection closed");
      elevenLabsWs.close();
    });

    elevenLabsWs.on("error", (error) => {
      console.error("[ElevenLabs] WebSocket error:", error);
    });

    elevenLabsWs.on("close", () => {
      console.log("[ElevenLabs] Connection closed");
    });
  });
});

// Start the Fastify server
fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
  console.log(`[Server] Listening on port ${PORT}`);
});