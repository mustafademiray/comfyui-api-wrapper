import express from "express";
import dotenv from "dotenv";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { promises as fsPromises } from "fs";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const serverAddress = process.env.COMFYUI_SERVER_ADDRESS || "localhost:8188";

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);

app.use(express.json());

// Queue prompt function
async function queuePrompt(prompt: any): Promise<any> {
  const clientId = uuidv4();
  const p = { prompt, client_id: clientId };
  const data = JSON.stringify(p);

  console.log(`Sending prompt to ${serverAddress}/prompt`);
  // Remove logging of entire prompt data
  // console.log(`Prompt data: ${data}`);

  try {
    const response = await fetch(`http://${serverAddress}/prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: data,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log(
      `Received response from prompt queue: ${JSON.stringify(result)}`
    );
    return result;
  } catch (error) {
    console.error("Error queueing prompt:", error);
    throw error;
  }
}

// Get image function
async function getImage(
  filename: string,
  subfolder: string,
  folderType: string
): Promise<Buffer> {
  const params = new URLSearchParams({ filename, subfolder, type: folderType });
  const url = `http://${serverAddress}/view?${params}`;
  console.log(`Fetching image from URL: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    console.log(
      `Image fetched successfully, size: ${arrayBuffer.byteLength} bytes`
    );
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`Error fetching image from ${url}:`, error);
    throw error;
  }
}

// Get history for a prompt ID
async function getHistory(promptId: string): Promise<any> {
  const response = await fetch(`http://${serverAddress}/history/${promptId}`);
  return response.json();
}

// Load workflow JSON at startup
let workflowJson: any;

async function loadWorkflow() {
  try {
    const workflowData = await readFileAsync(
      path.join(__dirname, "..", "workflow_api.json"),
      "utf-8"
    );
    workflowJson = JSON.parse(workflowData);
    console.log("Workflow JSON loaded successfully");
  } catch (error) {
    console.error("Error loading workflow JSON:", error);
    process.exit(1);
  }
}

loadWorkflow();

// New function to save images
async function saveImages(
  images: { [key: string]: Buffer[] },
  seed: number
): Promise<string[]> {
  const outputDir = path.join(__dirname, "..", "output");
  console.log(`Attempting to create/access output directory: ${outputDir}`);
  await fsPromises.mkdir(outputDir, { recursive: true });

  const savedPaths: string[] = [];

  for (const [nodeId, buffers] of Object.entries(images)) {
    for (let i = 0; i < buffers.length; i++) {
      const filename = `${nodeId}-${seed}-${i}.png`;
      const filePath = path.join(outputDir, filename);
      console.log(`Attempting to save image: ${filePath}`);
      try {
        await fsPromises.writeFile(filePath, buffers[i]);
        savedPaths.push(filePath);
        console.log(`Successfully saved image: ${filePath}`);
      } catch (error) {
        console.error(`Error saving image ${filePath}:`, error);
      }
    }
  }

  console.log(`Saved ${savedPaths.length} images to ${outputDir}`);
  return savedPaths;
}

// Test generate images function
app.post("/test-generate-images", async (req, res) => {
  try {
    console.log("Starting test-generate-images...");
    const clientId = uuidv4();
    const ws = new WebSocket(`ws://${serverAddress}/ws?clientId=${clientId}`);

    ws.on("open", () => {
      console.log("WebSocket connection opened");
    });

    // Use the pre-loaded workflow
    const workflow = JSON.parse(JSON.stringify(workflowJson));

    // Customize workflow with some default values
    workflow["6"]["inputs"]["text"] =
      "(Digital Artwork:1.3) of (Sketched:1.1) octane render of a mysterious dense forest with a large (magical:1.2) gate (portal:1.3) to the eternal kingdom, blade runner, intricate (vine:1.2), massive tree in liquid metal, realistic digital painting portrait, shot at 8k resolution, petrol liquid, pastel color, splash art, blue and purple magic universe, light engrave in intricate details, (light particle:1.2), (game concept:1.3), (depth of field:1.3), global illumination,Highly Detailed,Trending on ArtStation";
    workflow["7"]["inputs"]["text"] = "ugly, deformed";
    workflow["3"]["inputs"]["steps"] = 15;
    workflow["5"]["inputs"]["width"] = 512;
    workflow["5"]["inputs"]["height"] = 512;
    workflow["3"]["inputs"]["seed"] =
      Math.floor(Math.random() * 1000000000) + 1;

    console.log("Queueing prompt...");
    const { prompt_id } = await queuePrompt(workflow);
    console.log(`Prompt queued with ID: ${prompt_id}`);

    const outputImages: { [key: string]: Buffer[] } = {};

    function handleMessages() {
      return new Promise((resolve, reject) => {
        let messageCount = 0;
        const maxMessages = 500;
        let lastMessageTime = Date.now();
        const timeout = setTimeout(() => {
          console.log("Timeout reached. Resolving handleMessages.");
          resolve(null);
        }, 600000); // 10 minutes timeout

        ws.on("message", async (data: WebSocket.Data) => {
          messageCount++;
          lastMessageTime = Date.now();
          console.log(`Message received: ${messageCount}`);
          if (data instanceof Buffer) {
            console.log(
              `Received binary data (likely a preview image), size: ${data.length} bytes`
            );
          } else if (typeof data === "string") {
            try {
              const message = JSON.parse(data);
              console.log(`Received message: ${JSON.stringify(message)}`);
              if (message.type === "progress") {
                console.log(
                  `Progress: ${message.data.value}/${message.data.max}`
                );
              } else if (message.type === "executing") {
                console.log(`Executing node: ${message.data.node}`);
                if (
                  message.data.node === null &&
                  message.data.prompt_id === prompt_id
                ) {
                  console.log("Execution complete");
                  clearTimeout(timeout);
                  resolve(message);
                  return;
                }
              }
            } catch (error) {
              console.error("Error parsing WebSocket message:", error);
            }
          }

          if (messageCount >= maxMessages) {
            console.log(
              `Reached maximum message count (${maxMessages}). Resolving.`
            );
            clearTimeout(timeout);
            resolve(null);
          }
        });

        // Check if we've stopped receiving messages for a while
        const checkInterval = setInterval(() => {
          if (Date.now() - lastMessageTime > 3000) {
            // Changed from 10000 to 5000 (3 seconds)
            console.log(
              "No messages received for 3 seconds. Assuming completion."
            );
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve(null);
          }
        }, 1000);

        ws.on("close", () => {
          console.log("WebSocket connection closed");
          clearTimeout(timeout);
          resolve(null);
        });

        ws.on("error", (error) => {
          console.error("WebSocket error:", error);
          clearTimeout(timeout);
          reject(error);
        });
      });
    }

    console.log("Waiting for execution to complete...");
    await handleMessages();

    console.log("Fetching history...");
    const history = await getHistory(prompt_id);
    console.log("History fetched, processing outputs...");

    if (!history[prompt_id] || !history[prompt_id].outputs) {
      console.log("No outputs found in history");
      res.status(500).json({ error: "No outputs found in history" });
      return;
    }

    // Remove logging of entire history content
    // console.log("History content:", JSON.stringify(history, null, 2));

    for (const nodeId in history[prompt_id].outputs) {
      const nodeOutput = history[prompt_id].outputs[nodeId];
      if ("images" in nodeOutput) {
        console.log(`Processing images for node: ${nodeId}`);
        const imagesOutput: Buffer[] = [];
        for (const image of nodeOutput.images) {
          console.log(`Fetching image: ${image.filename}`);
          try {
            const imageData = await getImage(
              image.filename,
              image.subfolder,
              image.type
            );
            imagesOutput.push(imageData);
            console.log(
              `Image fetched successfully: ${image.filename}, size: ${imageData.length} bytes`
            );
          } catch (error) {
            console.error(`Error fetching image ${image.filename}:`, error);
          }
        }
        outputImages[nodeId] = imagesOutput;
      }
    }

    if (Object.keys(outputImages).length === 0) {
      console.log("No images were processed");
      res.status(500).json({ error: "No images were processed" });
      return;
    }

    console.log("All images processed, saving...");
    const savedPaths = await saveImages(
      outputImages,
      workflow["3"]["inputs"]["seed"]
    );

    console.log("Images saved, sending response...");
    res.json({
      seed: workflow["3"]["inputs"]["seed"],
      savedPaths: savedPaths,
    });

    ws.close();
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while generating test images" });
  }
});

// Generate images function
app.post("/generate-images", async (req, res) => {
  try {
    const {
      positivePrompt,
      negativePrompt,
      steps = 25,
      resolution = [512, 512],
    } = req.body;

    const ws = new WebSocket(`ws://${serverAddress}/ws?clientId=${uuidv4()}`);

    // Use the pre-loaded workflow instead of reading from file
    const workflow = JSON.parse(JSON.stringify(workflowJson));

    // Customize workflow based on inputs
    workflow["6"]["inputs"]["text"] = positivePrompt;
    workflow["7"]["inputs"]["text"] = negativePrompt;
    workflow["3"]["inputs"]["steps"] = steps;
    workflow["5"]["inputs"]["width"] = resolution[0];
    workflow["5"]["inputs"]["height"] = resolution[1];
    workflow["3"]["inputs"]["seed"] =
      Math.floor(Math.random() * 1000000000) + 1;

    const { prompt_id } = await queuePrompt(workflow);

    const outputImages: { [key: string]: Buffer[] } = {};

    return new Promise<{ seed: number; savedPaths: string[] }>(
      (resolve, reject) => {
        ws.on("message", async (data: WebSocket.Data) => {
          if (typeof data === "string") {
            const message = JSON.parse(data);
            if (
              message.type === "executing" &&
              message.data.node === null &&
              message.data.prompt_id === prompt_id
            ) {
              try {
                const history = await getHistory(prompt_id);
                for (const nodeId in history[prompt_id].outputs) {
                  const nodeOutput = history[prompt_id].outputs[nodeId];
                  if ("images" in nodeOutput) {
                    const imagesOutput: Buffer[] = [];
                    for (const image of nodeOutput.images) {
                      const imageData = await getImage(
                        image.filename,
                        image.subfolder,
                        image.type
                      );
                      imagesOutput.push(imageData);
                    }
                    outputImages[nodeId] = imagesOutput;
                  }
                }

                const savedPaths = await saveImages(
                  outputImages,
                  workflow["3"]["inputs"]["seed"]
                );

                resolve({
                  seed: workflow["3"]["inputs"]["seed"],
                  savedPaths: savedPaths,
                });
              } catch (error) {
                reject(error);
              } finally {
                ws.close();
              }
            }
          }
        });

        ws.on("error", (error) => {
          console.error("WebSocket error:", error);
          reject(error);
        });
      }
    );
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
