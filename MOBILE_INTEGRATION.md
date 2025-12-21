# Mobile App Integration Guide

This guide shows how to update your React Native mobile app to use the Lambda function instead of calling the Hive API directly.

## Step 1: Update AnalysisScreen.js

Replace the direct Hive API call with a call to your Lambda function endpoint.

### Current Implementation (Direct Hive API)

The current `AnalysisScreen.js` calls the Hive API directly with the API key exposed in the client.

### Updated Implementation (Using Lambda)

Update your `AnalysisScreen.js` to call the Lambda function:

```javascript
import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Image, Text, Animated, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { analysisStyles } from '../styles';
import colors from '../colors';

// Replace with your actual Lambda endpoint URL after deployment
const LAMBDA_ENDPOINT = 'https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/analyze';

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

        // Convert local image URI to base64
        const base64Image = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        // Determine image format from URI
        const imageFormat = imageUri.toLowerCase().includes('.png') ? 'png' : 'jpeg';
        const imageDataUrl = `data:image/${imageFormat};base64,${base64Image}`;

        setStatusMessage('Uploading image and analyzing...');

        // Call Lambda function
        const response = await fetch(LAMBDA_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image: imageDataUrl,
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
            console.log('Calling onComplete callback with analysis result');
            // Pass the Hive API response from Lambda
            onComplete({
              ...json.analysis,
              s3Url: json.s3Url, // Include S3 URL in response
            });
          }
        });
      } catch (error) {
        console.error('Error analyzing image:', error);
        if (isCancelled) {
          return;
        }
        setStatusMessage('Analysis failed. Please try again.');
        Alert.alert('Analysis Error', error.message || 'Unable to analyze image. Please try again.');

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

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={analysisStyles.container}>
      {/* Image Container */}
      <View style={analysisStyles.imageContainer}>
        <Image source={{ uri: imageUri }} style={analysisStyles.image} resizeMode="cover" />
      </View>

      {/* Analysis Progress Section */}
      <View style={analysisStyles.progressSection}>
        <View style={analysisStyles.progressHeader}>
          <Text style={analysisStyles.analyzingText}>Analyzing</Text>
          <Text style={analysisStyles.percentageText}>{Math.round(progress)}%</Text>
        </View>
        
        {/* Progress Bar */}
        <View style={analysisStyles.progressBarContainer}>
          <Animated.View
            style={[
              analysisStyles.progressBarFill,
              { width: progressWidth },
            ]}
          />
        </View>

        {/* Status Message */}
        <Text style={analysisStyles.statusMessage}>{statusMessage}</Text>
      </View>

      <StatusBar style="light" />
    </View>
  );
};

export default AnalysisScreen;
```

## Step 2: Environment Configuration

For better security and flexibility, use environment variables or a config file:

### Option 1: Create a config file

Create `catfish/config.js`:

```javascript
// config.js
const config = {
  // Replace with your Lambda endpoint after deployment
  LAMBDA_ENDPOINT: __DEV__ 
    ? 'https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/analyze' // Development
    : 'https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/analyze', // Production
};

export default config;
```

Then import it in `AnalysisScreen.js`:

```javascript
import config from '../config';
const LAMBDA_ENDPOINT = config.LAMBDA_ENDPOINT;
```

### Option 2: Use React Native environment variables

Install `react-native-dotenv`:

```bash
npm install react-native-dotenv
```

Create `.env` file:

```
LAMBDA_ENDPOINT=https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/analyze
```

## Step 3: Update the Prompt for Image Manipulation Detection

The Lambda function uses a prompt optimized for manipulation detection. If you want to customize it, update the `callHiveAPI` function in `image-analysis-handler.js`:

```javascript
text: 'Analyze this image for signs of manipulation, editing, or deepfake. Provide a detailed assessment including confidence level.',
```

You can modify this prompt to be more specific to your use case.

## Step 4: Testing

1. Deploy the Lambda function first (see main README.md)
2. Get the endpoint URL from the deployment output
3. Update `LAMBDA_ENDPOINT` in your mobile app
4. Test with a sample image

## Benefits of Using Lambda

1. **Security**: API keys are stored server-side, not in the mobile app
2. **S3 Storage**: Images are automatically stored in S3 for future reference
3. **Scalability**: Lambda handles high traffic automatically
4. **Cost**: Pay only for what you use
5. **Centralized Logic**: Easy to update analysis logic without app updates

## Error Handling

The Lambda function returns errors in this format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

Make sure your mobile app handles these errors gracefully and shows appropriate messages to users.

