#!/bin/bash

# Quick test curl command for the Gowinston Lambda endpoint
# 
# Usage:
#   ./test-gowinston-curl.sh [endpoint-url] [image-url] [version]
#
# Examples:
#   ./test-gowinston-curl.sh
#   ./test-gowinston-curl.sh https://api.gowinston.ai/v2/image-detection
#   ./test-gowinston-curl.sh https://api.gowinston.ai/v2/image-detection https://example.com/image.jpg
#   ./test-gowinston-curl.sh https://api.gowinston.ai/v2/image-detection https://example.com/image.jpg v1

# Default values
DEFAULT_ENDPOINT="${GOWINSTON_ENDPOINT:-https://api.gowinston.ai/v2/image-detection}"
DEFAULT_IMAGE_URL="https://drive.google.com/file/d/1lSAh586EWRgjU6xzwCLf6vhm-bdlL3r3/view?usp=sharing"
DEFAULT_VERSION="v1"

# Get parameters from command line arguments
ENDPOINT="${1:-$DEFAULT_ENDPOINT}"
IMAGE_URL="${2:-$DEFAULT_IMAGE_URL}"
VERSION="${3:-$DEFAULT_VERSION}"

echo "Testing Gowinston Lambda Endpoint"
echo "=================================="
echo "Endpoint: $ENDPOINT"
echo "Image URL: $IMAGE_URL"
echo "Version: $VERSION"
echo ""

# API Token
API_TOKEN="0KYRniLJtRJ9VdrsgNDSFcMmLTQ8cVI4PRiZooPU3dff2d1a"

# Make the curl request
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d "{
    \"url\": \"$IMAGE_URL\",
    \"version\": \"$VERSION\"
  }"

# Note: This uses the official GoWinston API v2 endpoint
# Authentication uses Bearer token in Authorization header
# If you need pretty-printed JSON, pipe to: | python -m json.tool



