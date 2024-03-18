import { awsConfig } from './aws.config';
import { RekognitionClient, DetectFacesCommand, FaceDetail } from "@aws-sdk/client-rekognition";
import { Image, } from "@aws-sdk/client-rekognition";
import * as fs from 'node:fs';
import path from 'node:path';
import sharp, { OverlayOptions } from 'sharp';

const client = new RekognitionClient(awsConfig);

function getImageFromBuffer(imageBuffer: Buffer): Image {
  const image = {
    Bytes: imageBuffer,
  };
  return image;
}

// @ts-ignore
async function hasFace(imageBuffer: Buffer) {
  const faces = await detectFaceDetails(imageBuffer);
  return faces?.length ?? 0 > 0 ? true : false;
}

async function detectFaceDetails(imageBuffer: Buffer) {
  const image = getImageFromBuffer(imageBuffer);
  const params = {
    Image: image,
    FaceAttributes: ["NONE"]
  };
  const command = new DetectFacesCommand(params);
  const response = await client.send(command);
  console.info(`Found ${response.FaceDetails?.length ?? 0} faces`);
  return response.FaceDetails;
}

interface Rectangle {
  x: number,
  y: number,
  width: number,
  height: number,
}

async function pixelateZone(image: Buffer, zone: Rectangle, pixelationLevel=50) {
  const zoneBuffer = await sharp(image).extract({
    left: zone.x,
    top: zone.y,
    width: zone.width,
    height: zone.height,
  }).toBuffer();
  const pixelatedZoneBuffer = await sharp(zoneBuffer).blur(pixelationLevel).toBuffer();
  const overlay: OverlayOptions = {
    input: pixelatedZoneBuffer,
    left: zone.x,
    top: zone.y,
  };
  return overlay
}

async function pixelateFace(imageBuffer: Buffer, face: FaceDetail) {
  if (!face || !face.BoundingBox) return null;
  const { Left, Top, Width, Height } = face.BoundingBox;
  if (!Left || !Top || !Width || !Height) return null;
  const { width, height } = await sharp(imageBuffer).metadata();
  if (!width || !height) return null;
  const rectangle: Rectangle = {
    x: Math.floor(Left * width),
    y: Math.floor(Top * height),
    width: Math.floor(Width * width),
    height: Math.floor(Height * height),
  };
  return pixelateZone(imageBuffer, rectangle);
}

async function pixelateFaces(imageBuffer: Buffer) {
  const faceDetails = await detectFaceDetails(imageBuffer);
  if (!faceDetails || faceDetails.length === 0) return null;
  const overlayOptions = await Promise.all(
    faceDetails.map(async (faceDetail) => {
      const overlayOption = await pixelateFace(imageBuffer, faceDetail)
      return overlayOption
    })
  )
  // @ts-ignore
  const filteredOverlays: OverlayOptions[] = overlayOptions.filter((overlayOption) => (overlayOption!==null));
  return sharp(imageBuffer).composite(filteredOverlays).webp().toBuffer();
}

async function start(filepath: string) {
  const fileUri = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(fileUri)) {
    console.error(`El archivo no existe: ${fileUri}`);
    process.exit(1)
  }
  try {
    const metadata = await sharp(fileUri).metadata();
    if (!metadata.format) {
      console.error('No es un archivo de imagen valido')
      process.exit(1)
    }
  } catch (error) {
    console.error(`Error no esperado: ${error}`)
    process.exit(1)
  }
  console.info(`Using ${fileUri}`);
  const imageBuffer = fs.readFileSync(fileUri);
  pixelateFaces(imageBuffer).then(
    (pixelatedImage) => {
      if (pixelatedImage && pixelatedImage.length > 0) {
        const parsedFileUri = path.parse(fileUri);
        const pixelatedName = `${parsedFileUri.name}_pixelated`;
        parsedFileUri.name = pixelatedName;
        parsedFileUri.base = `${pixelatedName}.webp`;
        const pixelatedUri = path.format(parsedFileUri);
        fs.writeFileSync(pixelatedUri, pixelatedImage);
        console.info(`Imagen con caras pixeladas en ${pixelatedUri}`);
      } else {
        console.error('Error pixelating')
        process.exit(1)
      }
    }
  )
  // hasFace(imageBuffer).then(
  //   (result) => console.info(`The image ${fileUri} has ${result?'':'not '}face`)
  // )
}
console.debug("Argumentos:", process.argv);
const filePath = process.argv[2];
if (!filePath) {
  console.error("Agrega un path de archivo");
  process.exit(1);
}
start(filePath);
