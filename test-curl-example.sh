#!/bin/bash

# Quick test curl command for the Lambda endpoint
# This uses a minimal 1x1 pixel PNG image encoded in base64

curl -X POST https://cw30abur3e.execute-api.us-east-1.amazonaws.com/dev/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  }' \
  | jq '.'

# If jq is not installed, remove the | jq '.' part or install jq with: brew install jq

