/**
 * Local test script for the Lambda function
 * 
 * Usage: node test-local.js
 * 
 * Environment variables are loaded from .env file automatically.
 * Make sure to set the following in your .env file:
 * - API_USER (Sightengine API user)
 * - Api_Secret (Sightengine API secret)
 * - S3_BUCKET_NAME
 * - AWS_REGION (optional, defaults to us-east-1)
 * - AWS_ACCESS_KEY_ID (optional, for local AWS SDK)
 * - AWS_SECRET_ACCESS_KEY (optional, for local AWS SDK)
 */

// Load environment variables from .env file
require('dotenv').config();

const handler = require('./image-analysis-handler');
const fs = require('fs');
const path = require('path');

// Image folder path
const IMAGE_FOLDER = path.join(__dirname, '..', 'image');

// Supported image extensions
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/**
 * Discover all images in the image folder
 */
function discoverImages() {
  if (!fs.existsSync(IMAGE_FOLDER)) {
    console.warn(`Warning: Image folder not found at ${IMAGE_FOLDER}`);
    return [];
  }
  
  const files = fs.readdirSync(IMAGE_FOLDER);
  const images = files
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return IMAGE_EXTENSIONS.includes(ext);
    })
    .map(file => path.join(IMAGE_FOLDER, file))
    .sort(); // Sort alphabetically for consistent ordering
  
  return images;
}

// Discover all test images from the image folder
const TEST_IMAGES = discoverImages();

/**
 * Load image from file and convert to base64 data URI
 */
function loadImageData(imagePath) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }
  
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  
  // Determine content type from file extension
  const ext = path.extname(imagePath).toLowerCase();
  let contentType = 'image/jpeg';
  if (ext === '.png') contentType = 'image/png';
  else if (ext === '.webp') contentType = 'image/webp';
  else if (ext === '.gif') contentType = 'image/gif';
  
  return `data:${contentType};base64,${base64}`;
}

/**
 * Create test event with image data
 */
function createTestEvent(imageData, imageName) {
  return {
    httpMethod: 'POST',
    body: JSON.stringify({
      image: imageData
    }),
    headers: {
      'Content-Type': 'application/json'
    },
    requestContext: {
      requestId: `test-request-${imageName}-${Date.now()}`,
      identity: {
        sourceIp: '127.0.0.1'
      }
    }
  };
}

/**
 * Test a single image
 */
async function testImage(imagePath) {
  const imageName = path.basename(imagePath);
  console.log('\n' + '='.repeat(70));
  console.log(`TESTING IMAGE: ${imageName}`);
  console.log('='.repeat(70));
  console.log('Image Path:', imagePath);
  
  try {
    const imageData = loadImageData(imagePath);
    const imageSizeKB = (imageData.length / 1024).toFixed(2);
    console.log('Image size:', imageSizeKB, 'KB');
    
    const testEvent = createTestEvent(imageData, imageName);
    console.log('\nCalling handler...\n');
    
    const result = await handler.handler(testEvent);
    const responseBody = JSON.parse(result.body);
    
    console.log('Status Code:', result.statusCode);
    console.log('Success:', responseBody.success);
    
    if (responseBody.success && responseBody.analysis) {
      const analysis = responseBody.analysis;
      
      console.log('\n📊 SIGHTENGINE API RESPONSE:');
      console.log('-'.repeat(70));
      
      // Pretty print key information
      if (analysis.status) {
        console.log('Status:', analysis.status);
      }
      
      if (analysis.request) {
        console.log('\nRequest Info:');
        console.log('  ID:', analysis.request.id);
        console.log('  Timestamp:', new Date(analysis.request.timestamp * 1000).toISOString());
        console.log('  Operations:', analysis.request.operations);
      }
      
      if (analysis.type) {
        console.log('\n🔍 Analysis Results:');
        Object.entries(analysis.type).forEach(([key, value]) => {
          const percentage = (value * 100).toFixed(2);
          const barLength = Math.round(value * 20);
          const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
          console.log(`  ${key.padEnd(15)}: ${value.toFixed(4)} (${percentage.padStart(6)}%) ${bar}`);
        });
      }
      
      if (analysis.media) {
        console.log('\n📷 Media Info:');
        console.log('  ID:', analysis.media.id);
        if (analysis.media.uri) {
          console.log('  URI:', analysis.media.uri);
        }
      }
      
      if (responseBody.s3Url) {
        console.log('\n☁️  S3 URL:', responseBody.s3Url);
      }
      
      if (responseBody.requestId) {
        console.log('\n🆔 Request ID:', responseBody.requestId);
      }
      
      console.log('\n' + '-'.repeat(70));
      console.log('FULL SIGHTENGINE RESPONSE:');
      console.log('-'.repeat(70));
      console.log(JSON.stringify(analysis, null, 2));
      
    } else if (responseBody.error) {
      console.log('\n❌ ERROR:', responseBody.error);
      if (responseBody.requestId) {
        console.log('Request ID:', responseBody.requestId);
      }
    }
    
    console.log('\n' + '-'.repeat(70));
    console.log('FULL LAMBDA RESPONSE:');
    console.log('-'.repeat(70));
    console.log(JSON.stringify(responseBody, null, 2));
    
    return { success: true, imageName, responseBody };
    
  } catch (error) {
    console.error('\n❌ Error processing image:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    return { success: false, imageName, error: error.message };
  }
}

/**
 * Main test function - tests all images
 */
async function test() {
  console.log('Testing Lambda function locally with all images...\n');
  
  // Check environment variables
  const apiUser = (process.env.API_USER || process.env.SIGHTENGINE_API_USER || '').trim();
  const apiSecret = (process.env.Api_Secret || process.env.SIGHTENGINE_API_SECRET || '').trim();
  
  if (!apiUser || !apiSecret) {
    console.error('ERROR: Sightengine API credentials not found');
    console.error('Please set API_USER and Api_Secret in your .env file');
    process.exit(1);
  }
  
  if (!process.env.S3_BUCKET_NAME) {
    console.warn('WARNING: S3_BUCKET_NAME environment variable is not set');
    console.warn('S3 upload will be skipped, but analysis will continue\n');
  }
  
  console.log('Environment variables OK');
  console.log('Sightengine API User:', apiUser);
  console.log('S3 Bucket:', process.env.S3_BUCKET_NAME || 'Not set (optional)');
  console.log(`\nFound ${TEST_IMAGES.length} test images to process`);
  
  // Filter to only existing images
  const existingImages = TEST_IMAGES.filter(img => fs.existsSync(img));
  const missingImages = TEST_IMAGES.filter(img => !fs.existsSync(img));
  
  if (missingImages.length > 0) {
    console.warn('\n⚠️  Warning: Some images not found:');
    missingImages.forEach(img => console.warn(`  - ${img}`));
  }
  
  if (existingImages.length === 0) {
    console.error('\n❌ ERROR: No test images found!');
    process.exit(1);
  }
  
  console.log(`\nProcessing ${existingImages.length} image(s)...\n`);
  
  // Test each image
  const results = [];
  for (let i = 0; i < existingImages.length; i++) {
    const imagePath = existingImages[i];
    const result = await testImage(imagePath);
    results.push(result);
    
    // Add a small delay between requests to avoid rate limiting
    if (i < existingImages.length - 1) {
      console.log('\n⏳ Waiting 1 second before next test...\n');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  results.forEach((result, index) => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.imageName}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    if (result.success && result.responseBody?.analysis?.type) {
      const deepfakeScore = result.responseBody.analysis.type.deepfake || 0;
      console.log(`   Deepfake score: ${(deepfakeScore * 100).toFixed(2)}%`);
    }
  });
  console.log('='.repeat(70));
  
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  console.log(`\nTotal: ${results.length} | Success: ${successCount} | Failed: ${failCount}`);
  
  if (failCount > 0) {
    process.exit(1);
  }
}

test();

