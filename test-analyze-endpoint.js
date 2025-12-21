/**
 * Test script to call the deployed analyze Lambda endpoint
 * 
 * Usage: 
 *   node test-analyze-endpoint.js [endpoint-url]
 * 
 * If no endpoint is provided, it will use the default endpoint.
 * You can also set ENDPOINT environment variable.
 * 
 * Example:
 *   node test-analyze-endpoint.js https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/analyze
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Default endpoint (update this with your actual endpoint)
const DEFAULT_ENDPOINT = process.env.ANALYZE_ENDPOINT || 'https://cw30abur3e.execute-api.us-east-1.amazonaws.com/dev/analyze';

// Get endpoint from command line argument or use default
const endpoint = process.argv[2] || DEFAULT_ENDPOINT;

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
function getImageData(imagePath) {
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
 * Format and display the response
 */
function displayResponse(response) {
  console.log('\n' + '='.repeat(70));
  console.log('LAMBDA RESPONSE');
  console.log('='.repeat(70));
  console.log('Status Code:', response.status);
  console.log('Status Text:', response.statusText);
  console.log('\n');
  
  const data = response.data;
  
  if (data.success && data.analysis) {
    const analysis = data.analysis;
    
    console.log('✅ SUCCESS');
    console.log('-'.repeat(70));
    
    // Display Sightengine response structure
    if (analysis.status) {
      console.log('\n📊 Status:', analysis.status);
    }
    
    if (analysis.request) {
      console.log('\n📋 Request Info:');
      console.log('   ID:', analysis.request.id);
      if (analysis.request.timestamp) {
        const date = new Date(analysis.request.timestamp * 1000);
        console.log('   Timestamp:', date.toISOString(), `(${analysis.request.timestamp})`);
      }
      if (analysis.request.operations) {
        console.log('   Operations:', analysis.request.operations);
      }
    }
    
    if (analysis.type) {
      console.log('\n🔍 Analysis Results:');
      Object.entries(analysis.type).forEach(([key, value]) => {
        const percentage = (value * 100).toFixed(2);
        const barLength = Math.round(value * 20);
        const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
        console.log(`   ${key.padEnd(15)}: ${value.toFixed(4)} (${percentage.padStart(6)}%) ${bar}`);
      });
    }
    
    if (analysis.media) {
      console.log('\n📷 Media Info:');
      console.log('   ID:', analysis.media.id);
      if (analysis.media.uri) {
        console.log('   URI:', analysis.media.uri);
      }
    }
    
    if (data.s3Url) {
      console.log('\n☁️  S3 URL:', data.s3Url);
    }
    
    if (data.requestId) {
      console.log('\n🆔 Request ID:', data.requestId);
    }
    
    console.log('\n' + '-'.repeat(70));
    console.log('FULL SIGHTENGINE RESPONSE:');
    console.log('-'.repeat(70));
    console.log(JSON.stringify(analysis, null, 2));
    
  } else if (data.error) {
    console.log('❌ ERROR');
    console.log('-'.repeat(70));
    console.log('Error:', data.error);
    if (data.requestId) {
      console.log('Request ID:', data.requestId);
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('FULL LAMBDA RESPONSE:');
  console.log('='.repeat(70));
  console.log(JSON.stringify(data, null, 2));
  console.log('='.repeat(70) + '\n');
}

/**
 * Test a single image against the deployed endpoint
 */
async function testImage(imagePath) {
  const imageName = path.basename(imagePath);
  console.log('\n' + '='.repeat(70));
  console.log(`TESTING IMAGE: ${imageName}`);
  console.log('='.repeat(70));
  console.log('Image Path:', imagePath);
  
  try {
    const imageData = getImageData(imagePath);
    const imageSizeKB = (imageData.length / 1024).toFixed(2);
    console.log('Image size:', imageSizeKB, 'KB');
    console.log('\nSending request to deployed Lambda...\n');
    
    const response = await axios.post(
      endpoint,
      {
        image: imageData
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60 second timeout
      }
    );
    
    displayResponse(response);
    return { success: true, imageName, response: response.data };
    
  } catch (error) {
    console.error('\n❌ Request Failed');
    console.error('='.repeat(70));
    
    if (error.response) {
      // Server responded with error status
      console.error('Status Code:', error.response.status);
      console.error('Status Text:', error.response.statusText);
      console.error('\nResponse Data:');
      console.error(JSON.stringify(error.response.data, null, 2));
      return { success: false, imageName, error: error.response.data };
    } else if (error.request) {
      // Request was made but no response received
      console.error('No response received from server');
      console.error('Error:', error.message);
      return { success: false, imageName, error: error.message };
    } else {
      // Error setting up the request
      console.error('Error:', error.message);
      return { success: false, imageName, error: error.message };
    }
  }
}

/**
 * Main test function - tests all images
 */
async function testAnalyze() {
  // Check if a specific image path was provided as third argument
  const specificImagePath = process.argv[3];
  
  console.log('Testing Deployed Lambda Endpoint');
  console.log('='.repeat(70));
  console.log('Endpoint:', endpoint);
  
  if (specificImagePath) {
    // Test single image if provided
    console.log(`\nTesting single image: ${specificImagePath}\n`);
    const result = await testImage(specificImagePath);
    process.exit(result.success ? 0 : 1);
  } else {
    // Test all images
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
    results.forEach((result) => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.imageName}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      if (result.success && result.response?.analysis?.type) {
        const deepfakeScore = result.response.analysis.type.deepfake || 0;
        console.log(`   Deepfake score: ${(deepfakeScore * 100).toFixed(2)}%`);
      }
    });
    console.log('='.repeat(70));
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    console.log(`\nTotal: ${results.length} | Success: ${successCount} | Failed: ${failCount}`);
    
    process.exit(failCount > 0 ? 1 : 0);
  }
}

// Run the test
testAnalyze();
