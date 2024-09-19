# ComfyUI Image Generation API

This project is a TypeScript-based Express server that interfaces with ComfyUI to generate images based on text prompts. It provides endpoints for testing image generation and custom image generation based on user inputs.

## Prerequisites

- Node.js (v14 or later)
- npm (Node Package Manager)
- ComfyUI server running locally or on a remote machine

## Setup

1. Clone the repository:

   ```
   git clone https://github.com/mustafademiray/comfyui-express.git
   cd comfyui-express
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Create a `.env` file in the root directory and add the following:

   ```
   PORT=3000
   COMFYUI_SERVER_ADDRESS=localhost:8188
   ```

   Adjust the `COMFYUI_SERVER_ADDRESS` if your ComfyUI server is running on a different address.

4. Ensure that the `workflow_api.json` file is present in the root directory of the project. (Exported from ComfyUI)

## Running the Server

To start the server in development mode with hot-reloading:

```
npm run dev
```

To build and run the server in production mode:

```
npm run build
npm start
```

## Available Endpoints

### 1. Test Image Generation

- **URL**: `/test-generate-images`
- **Method**: POST
- **Description**: Generates an image using predefined prompts and settings.

Example usage with curl:

```
curl -X POST http://localhost:3000/test-generate-images
```

### 2. Custom Image Generation

- **URL**: `/generate-images`
- **Method**: POST
- **Description**: Generates an image based on custom prompts and settings provided in the request body.
- **Body**:
  ```json
  {
    "positivePrompt": "a beautiful sunset over a calm ocean",
    "negativePrompt": "blurry, distorted, low quality",
    "steps": 30,
    "resolution": [768, 512]
  }
  ```

Example usage with curl:

```
curl -X POST http://localhost:3000/generate-images
```

## Output

Generated images are saved in the `output` folder in the project root directory. The API response includes the seed used for generation and the paths of the saved images.

Example response:

## Troubleshooting

- Ensure that the ComfyUI server is running and accessible at the address specified in the `.env` file.
- Check the console logs for any error messages or unexpected behavior.
- Verify that the `workflow_api.json` file is present and correctly formatted.
- If images are not being saved, check the permissions of the `output` folder.

## Development

To modify the default settings for the test image generation, you can edit the `workflow` object in the `/test-generate-images` endpoint in `server.ts`.

To add new endpoints or modify existing ones, edit the `server.ts` file and restart the server.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
