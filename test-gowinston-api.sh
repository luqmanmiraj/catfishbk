#!/bin/bash

# GoWinston API v2 Direct Test Script
# Tests the official GoWinston API directly with image URLs
# 
# API Documentation: https://docs.gowinston.ai
# Endpoint: https://api.gowinston.ai/v2/image-detection
# 
# Usage:
#   ./test-gowinston-api.sh [image-url] [version]
#
# Examples:
#   ./test-gowinston-api.sh                                              # Uses default image
#   ./test-gowinston-api.sh "https://example.com/image.jpg"              # Custom image URL
#   ./test-gowinston-api.sh "https://example.com/image.jpg" "v2"         # Custom URL with v2

# ============================================
# CONFIGURATION
# ============================================

# GoWinston API Token
# Replace with your actual token from https://dev.gowinston.ai
API_TOKEN="wTjZAXEt9uz3RJe9W9DVkTY9GLb0M2xrPxLKryO2d43986e4"

# API Endpoint
API_ENDPOINT="https://api.gowinston.ai/v2/image-detection"

# Default test image URL (a sample image for testing)
DEFAULT_IMAGE_URL="https://thumbs.dreamstime.com/z/beautiful-caucasian-woman-beauty-portrait-sensual-30904044.jpg?ct=jpeg"

# Default version (v1 or v2)
DEFAULT_VERSION="v1"

# ============================================
# PARSE ARGUMENTS
# ============================================

IMAGE_URL="${1:-$DEFAULT_IMAGE_URL}"
VERSION="${2:-$DEFAULT_VERSION}"

# ============================================
# VALIDATE URL
# ============================================

if [[ ! "$IMAGE_URL" =~ ^https?:// ]]; then
    echo ""
    echo "❌ Error: Invalid image URL"
    echo "   URL must start with http:// or https://"
    echo ""
    echo "Usage: ./test-gowinston-api.sh [image-url] [version]"
    echo "Example: ./test-gowinston-api.sh \"https://example.com/image.jpg\" \"v1\""
    echo ""
    exit 1
fi

# ============================================
# DISPLAY TEST INFORMATION
# ============================================

echo ""
echo "=========================================="
echo "GoWinston API v2 Test"
echo "=========================================="
echo "Endpoint:    $API_ENDPOINT"
echo "Image URL:   $IMAGE_URL"
echo "Version:     $VERSION"
echo "Token:       ${API_TOKEN:0:10}...${API_TOKEN: -4}"
echo "=========================================="
echo ""
echo "Sending request..."
echo ""

# ============================================
# MAKE API REQUEST
# ============================================

RESPONSE=$(curl -s -w "\n%{http_code}" --request POST \
  --url "$API_ENDPOINT" \
  --header "Authorization: Bearer $API_TOKEN" \
  --header "Content-Type: application/json" \
  --data "{
  \"url\": \"$IMAGE_URL\",
  \"version\": \"$VERSION\"
}")

# Extract HTTP status code from last line
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')

# ============================================
# DISPLAY RESPONSE
# ============================================

echo "=========================================="
echo "API RESPONSE:"
echo "=========================================="
echo ""

# Display response (with pretty-print if jq available)
if command -v jq &> /dev/null; then
    echo "$RESPONSE_BODY" | jq '.'
else
    echo "$RESPONSE_BODY"
fi

echo ""
echo "HTTP Status Code: $HTTP_CODE"
echo ""

# ============================================
# RESULT
# ============================================

echo "=========================================="

# Check HTTP status code
if [ -n "$HTTP_CODE" ] && [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ SUCCESS (HTTP $HTTP_CODE)"
    echo "=========================================="
    echo ""
    exit 0
elif [ -n "$HTTP_CODE" ] && [ "$HTTP_CODE" -ge 400 ]; then
    echo "❌ ERROR (HTTP $HTTP_CODE)"
    echo "=========================================="
    echo ""
    exit 1
elif [ -n "$HTTP_CODE" ]; then
    echo "⚠️  UNEXPECTED STATUS (HTTP $HTTP_CODE)"
    echo "=========================================="
    echo ""
    exit 0
else
    echo "❌ ERROR: No response received"
    echo "=========================================="
    echo ""
    exit 1
fi
