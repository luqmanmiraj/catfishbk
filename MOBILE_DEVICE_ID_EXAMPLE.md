# Mobile App: Sending Device ID Example

This guide shows how to update your React Native/Expo mobile app to send device ID with API requests.

## Step 1: Install Required Package

```bash
cd catfish
npm install expo-application
```

Or if using yarn:
```bash
yarn add expo-application
```

## Step 2: Create Device ID Helper

Create a new file `catfish/utils/deviceId.js`:

```javascript
import * as Application from 'expo-application';

/**
 * Get a persistent device/installation ID
 * This ID persists across app updates but changes on reinstall
 */
export async function getDeviceId() {
  try {
    // Get installation ID (persists across app updates)
    const installationId = await Application.getInstallationIdAsync();
    return installationId;
  } catch (error) {
    console.error('Error getting device ID:', error);
    // Fallback to a generated ID stored in AsyncStorage
    return await getOrCreateFallbackId();
  }
}

/**
 * Fallback: Create and store a device ID
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

async function getOrCreateFallbackId() {
  const STORAGE_KEY = '@catfish_device_id';
  
  try {
    let deviceId = await AsyncStorage.getItem(STORAGE_KEY);
    
    if (!deviceId) {
      // Generate a new UUID
      deviceId = generateUUID();
      await AsyncStorage.setItem(STORAGE_KEY, deviceId);
    }
    
    return deviceId;
  } catch (error) {
    console.error('Error with fallback device ID:', error);
    // Last resort: return a timestamp-based ID
    return `device-${Date.now()}`;
  }
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
```

## Step 3: Update AnalysisScreen.js

Update your `AnalysisScreen.js` to send device ID:

```javascript
import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Image, Text, Animated, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { getDeviceId } from '../utils/deviceId'; // Import the helper
import { analysisStyles } from '../styles';
import colors from '../colors';

// Replace with your actual Lambda endpoint URL
const LAMBDA_ENDPOINT = 'https://cw30abur3e.execute-api.us-east-1.amazonaws.com/dev/analyze';

const AnalysisScreen = ({ imageUri, onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState(
    'Analyzing image with Hive AI...'
  );
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let isCancelled = false;

    const analyzeWithLambda = async () => {
      if (!imageUri) {
        return;
      }

      try {
        setStatusMessage('Preparing image for analysis...');

        // Get device ID
        const deviceId = await getDeviceId();
        console.log('Device ID:', deviceId);

        // Convert local image URI to base64
        const base64Image = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        // Determine image format from URI
        const imageFormat = imageUri.toLowerCase().includes('.png') ? 'png' : 'jpeg';
        const imageDataUrl = `data:image/${imageFormat};base64,${base64Image}`;

        setStatusMessage('Uploading image and analyzing...');

        // Call Lambda function with device ID in header
        const response = await fetch(LAMBDA_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-ID': deviceId, // Send device ID in header
          },
          body: JSON.stringify({
            image: imageDataUrl,
            // Optionally also send in body (Lambda checks both)
            deviceId: deviceId,
          }),
        });

        const json = await response.json();

        if (isCancelled) {
          return;
        }

        if (!response.ok || !json.success) {
          console.error('Lambda error response:', json);
          throw new Error(json?.error || 'Analysis request failed');
        }

        setStatusMessage('Generating report...');

        // Animate progress bar to 100% before completing
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: false,
        }).start(() => {
          if (isCancelled) {
            return;
          }
          setProgress(100);
          if (onComplete) {
            console.log('Calling onComplete callback with result');
            onComplete(json);
          }
        });
      } catch (error) {
        console.error('Error analyzing image:', error);
        if (isCancelled) {
          return;
        }
        setStatusMessage('Analysis failed. Please try again.');
        Alert.alert('Analysis Error', 'Unable to analyze image. Please try again.');

        // Still complete the progress so user can go back / retry
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: false,
        }).start(() => {
          setProgress(100);
          if (onComplete) {
            onComplete(null);
          }
        });
      }
    };

    analyzeWithLambda();

    return () => {
      isCancelled = true;
    };
  }, [imageUri, progressAnim, onComplete]);

  // ... rest of component remains the same
};

export default AnalysisScreen;
```

## Step 4: Install AsyncStorage (if using fallback)

If you want to use the fallback device ID storage:

```bash
npm install @react-native-async-storage/async-storage
```

## Alternative: Using expo-device

You can also use `expo-device` for device information:

```bash
npm install expo-device
```

```javascript
import * as Device from 'expo-device';

// Get device model and OS info
const deviceInfo = {
  modelName: Device.modelName,
  osName: Device.osName,
  osVersion: Device.osVersion,
};

// Note: This doesn't provide a unique device ID, but can be combined
// with Application.getInstallationIdAsync() for a more complete identifier
```

## Testing

After updating your mobile app:

1. Make a request from the app
2. Check CloudWatch logs for the device ID
3. Query DynamoDB to see the request:

```bash
cd lambda
node query-requests.js --devices
```

## What Gets Tracked

For each request, the following is automatically logged:

- **Device ID**: Unique identifier for the device
- **IP Address**: Client IP address
- **User Agent**: Device/app information
- **Timestamp**: When the request was made
- **Success/Failure**: Whether the request succeeded
- **Request ID**: API Gateway request ID for tracing

## Privacy Considerations

- Device IDs are stored in DynamoDB for analytics
- Consider implementing user consent for tracking
- Device IDs should not contain personally identifiable information
- Consider hashing device IDs if privacy is a concern

