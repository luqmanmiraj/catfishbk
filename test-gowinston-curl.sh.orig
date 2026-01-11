#!/bin/bash

# Quick test curl command for the Gowinston Lambda endpoint
# 
# Usage:
#   ./test-gowinston-curl.sh [endpoint-url] [image-url] [version]
#
# Examples:
#   ./test-gowinston-curl.sh
#   ./test-gowinston-curl.sh https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/gowinston/detect
#   ./test-gowinston-curl.sh https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/gowinston/detect https://example.com/image.jpg
#   ./test-gowinston-curl.sh https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/gowinston/detect https://example.com/image.jpg v1

# Default values
DEFAULT_ENDPOINT="${GOWINSTON_ENDPOINT:-https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/gowinston/detect}"
DEFAULT_IMAGE_URL="https://images.unsplash.com/photo-1541963463532-d68292c34d19"
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

# Make the curl request
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"$IMAGE_URL\",
    \"version\": \"$VERSION\"
  }" \
  | jq '.'

# If jq is not installed, remove the | jq '.' part or install jq with: brew install jq
# Alternative without jq:
# curl -X POST "$ENDPOINT" \
#   -H "Content-Type: application/json" \
#   -d "{
#     \"url\": \"$IMAGE_URL\",
#     \"version\": \"$VERSION\"
#   }"






