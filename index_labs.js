import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import twilio from "twilio";

// Load environment variables from .env file
dotenv.config();

// Retrieve environment variables
const {
  OPENAI_API_KEY,
  ELEVENLABS_AGENT_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
} = process.env;

// Check for required environment variables
if (
  !OPENAI_API_KEY ||
  !TWILIO_ACCOUNT_SID ||
  !TWILIO_AUTH_TOKEN ||
  !TWILIO_PHONE_NUMBER
) {
  console.error(
    "Missing required environment variables. Please check your .env file."
  );
  process.exit(1);
}

// Initialize Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const fastify = Fastify({
  logger: true, // Add logging for better debugging
});

// Register plugins
await fastify.register(fastifyFormBody);
await fastify.register(fastifyWs);

// Constants
const SYSTEM_MESSAGE = `
You are a doctors apprentice, and your main responsibility is to make sure that the patient is doing well after the surgery.

!!! SO ALWAYS ASK THE QUESTIONS<Q_> BELOW AND COLLECT THE INFORMATION !!!
!!! AND INITIATE THE CONVERSATION ONLY IF THE PATIENT SAYS "YES" TO THE FIRST QUESTION !!!

You are assigned with a very important task of collecting information from the patient, by asking the <Questions> below
Since you are dealing with real persons, and that too patients, i want you to take good care of the patient and talk with empathy.
And you must ask theses qustions and get answers. This is the main aim of the call. SO BE SUBJECTIVE.

<Questions>
Post-Operative Questionnaire (1-Year Follow-Up)
Section 1: Pain and Symptoms
    <Q1>    On a scale of 0 to 10, how severe is your hip pain during daily activities now?(0 = no pain, 10 = worst pain imaginable) ?
    <Q2>    Do you experience stiffness in the operated hip joint?
    ◦    Rarely
    ◦    Occasionally
    ◦    Frequently
    ◦    Always
Section 2: Physical Function
    <Q3>    How much improvement have you noticed in your ability to perform the following activities since surgery?(Rate: 1 = no improvement, 5 = complete recovery)
    •    Walking on a flat surface.
    •    Climbing stairs.
    •    Bending to pick up objects.
    •    Putting on socks or shoes.

    <Q4>    Are you able to participate in physical activities or hobbies that were difficult before surgery?
    ◦    Yes: __
    ◦    No
Section 3: Satisfaction and Quality of Life
    <Q5>    How satisfied are you with the results of your hip replacement surgery?(Rate: 1 = very dissatisfied, 5 = very satisfied)

    <Q6>    Do you feel the surgery has met your expectations?
    •    Yes
    •    No
Section 4: Challenges and Follow-Up Needs
    <Q7> sAre you experiencing any challenges or discomfort in the operated hip?
    •    Yes: __
    •    No

    <Q8>    Would you recommend this procedure to someone with a similar condition? Why or why not?
</Questions>
`;

const VOICE = "alloy";
const PORT = process.env.PORT || 8000; // Allow dynamic port assignment

// List of Event Types to log to the console. See the OpenAI Realtime API Documentation: https://platform.openai.com/docs/api-reference/realtime
const LOG_EVENT_TYPES = [
  "error",
  "response.content.done",
  "rate_limits.updated",
  "response.done",
  "input_audio_buffer.committed",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.speech_started",
  "session.created",
];


// Show AI response elapsed timing calculations
const SHOW_TIMING_MATH = false;

// Add this HTML string near your other constants
const HTML_FORM = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Make Outbound Call</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
        }
        .container {
            background-color: #f5f5f5;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        input[type="tel"] {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 16px;
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
        #status {
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
        
        /* Add these new styles */
        .chat-container {
            margin-top: 20px;
            padding: 15px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            height: 300px;
            overflow-y: auto;
        }
        .message {
            margin: 10px 0;
            padding: 8px;
            border-radius: 6px;
        }
        .assistant {
            background-color: #e3f2fd;
            margin-right: 20%;
        }
        .user {
            background-color: #f5f5f5;
            margin-left: 20%;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Make Outbound Call</h1>
        <form id="callForm">
            <div class="form-group">
                <label for="phoneNumber">Phone Number:</label>
                <input type="tel" id="phoneNumber" name="phoneNumber" 
                       placeholder="+1234567890" required
                       pattern="^\\+?[1-9]\\d{1,14}$">
                <small>Format: +1234567890 (include country code)</small>
            </div>
            <div class="form-group">
                <label for="patientInfo">Patient Info:</label>
                <textarea id="patientInfo" name="patientInfo" rows="4" cols="50"></textarea>
            </div>
            <button type="submit">Make Call</button>
        </form>
        <div id="status"></div>
        
        <!-- Add chat display area -->
        <div class="chat-container" id="chatDisplay">
            <div class="message assistant">Waiting for call to begin...</div>
        </div>
    </div>

    <script>
        const chatDisplay = document.getElementById('chatDisplay');
        
        // Function to add message to chat
        function addMessage(text, isAssistant = true) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + (isAssistant ? 'assistant' : 'user');
            messageDiv.textContent = text;
            chatDisplay.appendChild(messageDiv);
            chatDisplay.scrollTop = chatDisplay.scrollHeight;
        }

        // WebSocket connection for chat updates
        let chatSocket = null;

        function connectWebSocket(callSid) {
            chatSocket = new WebSocket(\`wss://\${window.location.host}/chat-updates/\${callSid}\`);
            
            chatSocket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'message') {
                    addMessage(data.content, data.role === 'assistant');
                }
            };

            chatSocket.onclose = () => {
                addMessage('Call ended', true);
            };
        }

        document.getElementById('callForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const statusDiv = document.getElementById('status');
            const phoneNumber = document.getElementById('phoneNumber').value;
            const patientInfo = document.getElementById('patientInfo').value;
            try {
                statusDiv.innerHTML = 'Initiating call...';
                statusDiv.className = '';
                chatDisplay.innerHTML = ''; // Clear previous chat
                addMessage('Initiating call...', true);

                const response = await fetch('/make-call', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ phoneNumber, patientInfo })
                });

                const data = await response.json();

                if (data.success) {
                    statusDiv.innerHTML = \`Call initiated successfully! Call SID: \${data.callSid}\`;
                    statusDiv.className = 'success';
                    addMessage('Call connected. Waiting for conversation to begin...', true);
                    connectWebSocket(data.callSid);
                } else {
                    throw new Error(data.error || 'Failed to initiate call');
                }
            } catch (error) {
                statusDiv.innerHTML = \`Error: \${error.message}\`;
                statusDiv.className = 'error';
                addMessage('Error: ' + error.message, true);
            }
        });
    </script>
</body>
</html>
`;

// Replace your existing root route with this:
fastify.get("/", async (request, reply) => {
  reply.header("Content-Type", "text/html").send(HTML_FORM);
});


// Route for Twilio to handle incoming calls
// <Say> punctuation to improve text-to-speech translation
fastify.all("/incoming-call", async (request, reply) => {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
      </Connect>
    </Response>`;

  reply.type("text/xml").send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    console.log("Client connected");

    // Connection-specific state
    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestampTwilio = null;

    // Get patient info for this stream
    let patientInfo = null;
    if (streamSid && global.patientData && global.patientData.has(streamSid)) {
      patientInfo = global.patientData.get(streamSid);
    }

    const wsUrl = new URL(`wss://api.elevenlabs.io/v1/convai/conversation`);
    wsUrl.searchParams.append('agent_id', ELEVENLABS_AGENT_ID);

    const elevenLabsWs = new WebSocket(wsUrl.toString(), {
      headers: {
        "Accept": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json"
      }
    });

    // Control initial session with OpenAI

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

    // Send initial conversation item if AI talks first
    const sendInitialConversationItem = () => {
      const greeting = patientInfo?.name
        ? `Hello I'm  ${patientInfo.name}, Who are you ?`
        : "Hello, Who are you?";

      const initialConversationItem = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: greeting,
            },
          ],
        },
      };

      if (SHOW_TIMING_MATH)
        console.log(
          "Sending initial conversation item:",
          JSON.stringify(initialConversationItem)
        );
      openAiWs.send(JSON.stringify(initialConversationItem));
      openAiWs.send(JSON.stringify({ type: "response.create" }));
    };

    // Handle interruption when the caller's speech starts
    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH)
          console.log(
            `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`
          );

        if (lastAssistantItem) {
          const truncateEvent = {
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime,
          };
          if (SHOW_TIMING_MATH)
            console.log(
              "Sending truncation event:",
              JSON.stringify(truncateEvent)
            );
          openAiWs.send(JSON.stringify(truncateEvent));
        }

        connection.send(
          JSON.stringify({
            event: "clear",
            streamSid: streamSid,
          })
        );

        // Reset
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    // Send mark messages to Media Streams so we know if and when AI response playback is finished
    const sendMark = (connection, streamSid) => {
      if (streamSid) {
        const markEvent = {
          event: "mark",
          streamSid: streamSid,
          mark: { name: "responsePart" },
        };
        connection.send(JSON.stringify(markEvent));
        markQueue.push("responsePart");
      }
    };

    // Open event for OpenAI WebSocket
    openAiWs.on("open", () => {
      console.log("Connected to the OpenAI Realtime API");
      setTimeout(initializeSession, 100);
    });

    // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
    openAiWs.on("message", (data) => {
      try {
        const response = JSON.parse(data);

        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`Received event: ${response.type}`, response.output);
        }

        if (response.type === "response.audio.delta" && response.delta) {
          const audioDelta = {
            event: "media",
            streamSid: streamSid,
            media: {
              payload: Buffer.from(response.delta, "base64").toString("base64"),
            },
          };
          connection.send(JSON.stringify(audioDelta));

          // First delta from a new response starts the elapsed time counter
          if (!responseStartTimestampTwilio) {
            responseStartTimestampTwilio = latestMediaTimestamp;
            if (SHOW_TIMING_MATH)
              console.log(
                `Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`
              );
          }

          if (response.item_id) {
            lastAssistantItem = response.item_id;
          }

          sendMark(connection, streamSid);
        }

        if (response.type === "input_audio_buffer.speech_started") {
          handleSpeechStartedEvent();
        }

        // Send text responses to frontend
        if (response.type === "response.content.done" && response.output) {
          const chatMessage = {
            type: "message",
            role: "assistant",
            content: response.output,
          };

          // Send to all connected chat clients for this call
          if (global.chatConnections && global.chatConnections.has(streamSid)) {
            global.chatConnections
              .get(streamSid)
              .socket.send(JSON.stringify(chatMessage));
          }
        }
      } catch (error) {
        console.error(
          "Error processing OpenAI message:",
          error,
          "Raw message:",
          data
        );
      }
    });

    // Handle incoming messages from Twilio
    connection.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case "media":
            latestMediaTimestamp = data.media.timestamp;
            if (SHOW_TIMING_MATH)
              console.log(
                `Received media message with timestamp: ${latestMediaTimestamp}ms`
              );
            if (openAiWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: "input_audio_buffer.append",
                audio: data.media.payload,
              };
              openAiWs.send(JSON.stringify(audioAppend));
            }
            break;
          case "start":
            streamSid = data.start.streamSid;
            console.log("Incoming stream has started", streamSid);

            // Get patient info for this stream
            if (global.patientData && global.patientData.has(streamSid)) {
              patientInfo = global.patientData.get(streamSid);
              console.log("Retrieved patient info for stream:", patientInfo);
            }

            // Reset start and media timestamp on a new stream
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            break;
          case "mark":
            if (markQueue.length > 0) {
              markQueue.shift();
            }
            break;
          default:
            console.log("Received non-media event:", data.event);
            break;
        }
      } catch (error) {
        console.error("Error parsing message:", error, "Message:", message);
      }
    });

    // Handle connection close
    connection.on("close", () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log("Client disconnected.");
    });

    // Handle WebSocket close and errors
    openAiWs.on("close", () => {
      console.log("Disconnected from the OpenAI Realtime API");
    });

    openAiWs.on("error", (error) => {
      console.error("Error in the OpenAI WebSocket:", error);
    });
  });
});

// Modify the makeOutboundCall function to accept patient info
async function makeOutboundCall(targetNumber, patientInfo) {
  try {
    // Store patient info for this call
    if (!global.patientData) {
      global.patientData = new Map();
    }

    const call = await twilioClient.calls.create({
      from: TWILIO_PHONE_NUMBER,
      to: targetNumber,
      url: `https://${process.env.NGROK_URL}/incoming-call`,
      statusCallback: `https://${process.env.NGROK_URL}/call-status`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    });

    // Store patient info mapped to call SID
    global.patientData.set(call.sid, patientInfo);

    console.log(`Initiated call with SID: ${call.sid}`);
    return call;
  } catch (error) {
    console.error("Error making outbound call:", error);
    throw error;
  }
}

// Update the make-call route to accept patient info
fastify.post("/make-call", async (request, reply) => {
  console.log("Request body:", request.body);
  try {
    const { phoneNumber, patientInfo } = request.body;

    // Validate required phone number
    if (!phoneNumber) {
      return reply.code(400).send({ error: "Phone number is required" });
    }

    // Optional patient info validation
    const validatedPatientInfo = patientInfo
      ? {
          name: patientInfo.name || "",
          age: patientInfo.age || "",
          gender: patientInfo.gender || "",
          medicalHistory: patientInfo.medicalHistory || "",
        }
      : null;

    const call = await makeOutboundCall(phoneNumber, validatedPatientInfo);
    return reply.send({
      success: true,
      message: "Call initiated successfully",
      callSid: call.sid,
    });
  } catch (error) {
    console.error("Error in /make-call route:", error);
    return reply.code(500).send({
      success: false,
      error: error.message,
    });
  }
});

// Add route to handle call status callbacks
fastify.post("/call-status", async (request, reply) => {
  const callStatus = request.body;
  console.log("Call status update:", callStatus);
  reply.send({ received: true });
});

// Add this new WebSocket route for chat updates
fastify.register(async (fastify) => {
  fastify.get(
    "/chat-updates/:callSid",
    { websocket: true },
    (connection, req) => {
      const callSid = req.params.callSid;
      console.log(`Chat WebSocket connected for call ${callSid}`);

      // Store the connection for this call
      if (!global.chatConnections) {
        global.chatConnections = new Map();
      }
      global.chatConnections.set(callSid, connection);

      connection.socket.on("close", () => {
        global.chatConnections.delete(callSid);
        console.log(`Chat WebSocket disconnected for call ${callSid}`);
      });
    }
  );
});

// Update your CORS settings in index.js
fastify.addHook("onRequest", (request, reply, done) => {
  // Replace with your frontend URL in production
  reply.header("Access-Control-Allow-Origin", "http://localhost:3000");
  reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (request.method === "OPTIONS") {
    reply.send();
    return;
  }
  done();
});

fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});
