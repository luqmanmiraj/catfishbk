#!/bin/bash

# Token Pack Purchase Test Script
# Tests the token pack purchase endpoint (/subscription/purchase)
# 
# Usage:
#   ./test-token-pack-purchase.sh [pack-id] [access-token] [endpoint-url]
#
# Examples:
#   ./test-token-pack-purchase.sh pack_15 "your-access-token"
#   ./test-token-pack-purchase.sh pack_50 "your-access-token" https://your-api.execute-api.us-east-1.amazonaws.com/dev/subscription/purchase
#   ./test-token-pack-purchase.sh all "your-access-token"
#
# Environment Variables:
#   API_BASE_URL - Base API URL (optional)
#   ACCESS_TOKEN - Default access token (optional)

# ============================================
# CONFIGURATION
# ============================================

# Default API base URL
DEFAULT_API_BASE="${API_BASE_URL:-https://3oaimkf4g6.execute-api.us-east-1.amazonaws.com/dev}"

# Default values
DEFAULT_PACK_ID="pack_15"

# Available token packs
declare -A TOKEN_PACKS=(
    ["pack_15"]="15|4.99"
    ["pack_50"]="50|9.99"
    ["pack_100"]="100|16.99"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================
# HELPER FUNCTIONS
# ============================================

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_header() {
    echo -e "${CYAN}$1${NC}"
}

# Get token balance for a user
get_token_balance() {
    local access_token="$1"
    local endpoint="$2"
    
    local status_url="${endpoint%/purchase}/status"
    
    local response=$(curl -s -w "\n%{http_code}" -X GET "$status_url" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $access_token")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        echo "$body" | grep -o '"tokenBalance":[0-9]*' | grep -o '[0-9]*' || echo "0"
    else
        echo "0"
    fi
}

# Test purchasing a token pack
test_purchase_token_pack() {
    local pack_id="$1"
    local access_token="$2"
    local endpoint="$3"
    
    # Validate pack ID
    if [ -z "${TOKEN_PACKS[$pack_id]}" ]; then
        print_error "Invalid pack ID: $pack_id"
        print_info "Available packs: pack_15, pack_50, pack_100"
        return 1
    fi
    
    # Extract pack info
    IFS='|' read -r tokens price <<< "${TOKEN_PACKS[$pack_id]}"
    
    echo ""
    print_header "============================================================"
    print_header "TESTING TOKEN PACK PURCHASE"
    print_header "============================================================"
    print_info "Pack ID: $pack_id"
    print_info "Tokens: $tokens"
    print_info "Price: \$$price"
    print_info "Endpoint: $endpoint"
    echo ""
    
    # Get balance before purchase
    print_info "Getting token balance before purchase..."
    local balance_before=$(get_token_balance "$access_token" "$endpoint")
    print_info "Current token balance: $balance_before"
    echo ""
    
    # Generate transaction ID
    local transaction_id="test-txn-$(date +%s)000"
    
    # Create request body
    local request_body=$(cat <<EOF
{
  "packId": "$pack_id",
  "transactionId": "$transaction_id"
}
EOF
)
    
    # Display request
    print_info "Request Body:"
    echo "$request_body" | python3 -m json.tool 2>/dev/null || echo "$request_body"
    echo ""
    print_info "Authorization Header: Bearer ${access_token:0:20}...${access_token: -10}"
    echo ""
    
    # Make the purchase request
    print_info "Sending purchase request..."
    echo ""
    
    local response=$(curl -s -w "\n%{http_code}" -X POST "$endpoint" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $access_token" \
        -d "$request_body")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    # Display results
    print_header "============================================================"
    print_header "RESPONSE"
    print_header "============================================================"
    print_info "HTTP Status Code: $http_code"
    echo ""
    
    if [ "$http_code" = "200" ]; then
        print_success "SUCCESS - Token pack purchased successfully"
        echo ""
        print_info "Response Body:"
        echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
        echo ""
        
        # Extract new balance from response
        local new_balance=$(echo "$body" | grep -o '"tokenBalance":[0-9]*' | grep -o '[0-9]*' || echo "")
        if [ -n "$new_balance" ]; then
            echo ""
            print_info "Balance Summary:"
            print_info "  Before: $balance_before tokens"
            print_info "  Added: $tokens tokens"
            print_info "  After: $new_balance tokens"
            
            # Verify balance increased correctly
            local expected_balance=$((balance_before + tokens))
            if [ "$new_balance" = "$expected_balance" ]; then
                print_success "Balance updated correctly!"
            else
                print_warning "Balance mismatch! Expected: $expected_balance, Got: $new_balance"
            fi
        fi
    elif [ "$http_code" = "400" ]; then
        print_error "BAD REQUEST - Invalid pack ID or missing parameters"
        echo ""
        print_info "Error Details:"
        echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
        echo ""
        print_warning "Common causes:"
        print_warning "  1. Invalid or expired access token (userId cannot be extracted)"
        print_warning "  2. Missing or invalid packId in request body"
        print_warning "  3. packId must be one of: pack_15, pack_50, pack_100"
        print_info ""
        print_info "Troubleshooting:"
        print_info "  - Verify your access token is valid and not expired"
        print_info "  - Check that packId is correctly set: $pack_id"
        print_info "  - Try signing in again to get a fresh token"
    elif [ "$http_code" = "401" ]; then
        print_error "UNAUTHORIZED - Invalid or expired access token"
        echo ""
        print_info "Error Details:"
        echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
        print_warning "Make sure you're using a valid access token from sign-in"
    elif [ "$http_code" = "500" ]; then
        print_error "SERVER ERROR - Check server logs"
        echo ""
        print_info "Error Details:"
        echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    else
        print_warning "Unexpected status code: $http_code"
        echo ""
        print_info "Response:"
        echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    fi
    
    echo ""
    print_header "============================================================"
    echo ""
    
    return $([ "$http_code" = "200" ] && echo 0 || echo 1)
}

# Test invalid pack ID
test_invalid_pack() {
    local access_token="$1"
    local endpoint="$2"
    
    echo ""
    print_header "============================================================"
    print_header "TESTING INVALID PACK ID"
    print_header "============================================================"
    
    local request_body='{"packId": "invalid_pack", "transactionId": "test-txn-123"}'
    
    print_info "Testing with invalid pack ID: invalid_pack"
    echo ""
    
    local response=$(curl -s -w "\n%{http_code}" -X POST "$endpoint" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $access_token" \
        -d "$request_body")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    print_info "HTTP Status Code: $http_code"
    
    if [ "$http_code" = "400" ]; then
        print_success "CORRECTLY REJECTED invalid pack ID"
    else
        print_error "SHOULD HAVE REJECTED invalid pack ID (expected 400, got $http_code)"
    fi
    
    echo ""
    print_info "Response:"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    echo ""
    print_header "============================================================"
    echo ""
}

# Test without authentication
test_no_auth() {
    local endpoint="$2"
    
    echo ""
    print_header "============================================================"
    print_header "TESTING WITHOUT AUTHENTICATION"
    print_header "============================================================"
    
    local request_body='{"packId": "pack_15", "transactionId": "test-txn-123"}'
    
    print_info "Testing without Authorization header"
    echo ""
    
    local response=$(curl -s -w "\n%{http_code}" -X POST "$endpoint" \
        -H "Content-Type: application/json" \
        -d "$request_body")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    print_info "HTTP Status Code: $http_code"
    
    if [ "$http_code" = "401" ] || [ "$http_code" = "400" ]; then
        print_success "CORRECTLY REJECTED request without authentication"
    else
        print_warning "Unexpected response (expected 401/400, got $http_code)"
    fi
    
    echo ""
    print_info "Response:"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    echo ""
    print_header "============================================================"
    echo ""
}

# Run all tests
run_all_tests() {
    local access_token="$1"
    local endpoint="$2"
    
    echo ""
    print_header "🧪 Running comprehensive token pack purchase tests..."
    echo ""
    
    local results=()
    
    # Test all pack sizes
    for pack_id in "${!TOKEN_PACKS[@]}"; do
        echo "📋 Testing $pack_id..."
        if test_purchase_token_pack "$pack_id" "$access_token" "$endpoint"; then
            results+=("✅ $pack_id")
        else
            results+=("❌ $pack_id")
        fi
        sleep 1
    done
    
    # Test invalid pack
    echo ""
    echo "📋 Testing invalid pack ID..."
    test_invalid_pack "$access_token" "$endpoint"
    
    # Test without auth
    echo ""
    echo "📋 Testing without authentication..."
    test_no_auth "" "$endpoint"
    
    # Summary
    echo ""
    print_header "============================================================"
    print_header "TEST SUMMARY"
    print_header "============================================================"
    for result in "${results[@]}"; do
        echo "$result"
    done
    print_header "============================================================"
    echo ""
}

# ============================================
# MAIN SCRIPT
# ============================================

# Parse arguments
PACK_ID="${1:-$DEFAULT_PACK_ID}"
# Get access token from argument or environment variable
if [ -n "$2" ]; then
    ACCESS_TOKEN="$2"
elif [ -n "${ACCESS_TOKEN:-}" ]; then
    ACCESS_TOKEN="${ACCESS_TOKEN}"
else
    ACCESS_TOKEN=""
fi
ENDPOINT="${3:-$DEFAULT_API_BASE/subscription/purchase}"

# Check if running all tests
if [ "$PACK_ID" = "all" ] || [ "$PACK_ID" = "ALL" ]; then
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "Access token is required for testing"
        print_info "Usage: ./test-token-pack-purchase.sh all <access-token> [endpoint]"
        print_info ""
        print_info "To get an access token:"
        print_info "  1. Sign in via: POST $DEFAULT_API_BASE/auth/signin"
        print_info "  2. Copy the accessToken from the response"
        exit 1
    fi
    run_all_tests "$ACCESS_TOKEN" "$ENDPOINT"
    exit 0
fi

# Display configuration
print_header "============================================================"
print_header "TOKEN PACK PURCHASE TEST"
print_header "============================================================"
echo ""

# Validate access token
if [ -z "$ACCESS_TOKEN" ]; then
    print_error "Access token is required"
    print_info ""
    print_info "Usage:"
    print_info "  ./test-token-pack-purchase.sh [pack-id] <access-token> [endpoint]"
    print_info ""
    print_info "Examples:"
    print_info "  ./test-token-pack-purchase.sh pack_15 \"your-access-token\""
    print_info "  ./test-token-pack-purchase.sh pack_50 \"your-access-token\""
    print_info "  ./test-token-pack-purchase.sh pack_100 \"your-access-token\""
    print_info "  ./test-token-pack-purchase.sh all \"your-access-token\""
    print_info ""
    print_info "To get an access token:"
    print_info "  1. Sign in: curl -X POST $DEFAULT_API_BASE/auth/signin \\"
    print_info "     -H 'Content-Type: application/json' \\"
    print_info "     -d '{\"email\":\"your-email@example.com\",\"password\":\"your-password\"}'"
    print_info "  2. Copy the 'accessToken' from the response"
    exit 1
fi

# Validate endpoint URL
if [[ ! "$ENDPOINT" =~ ^https?:// ]]; then
    print_error "Invalid endpoint URL: $ENDPOINT"
    print_info "URL must start with http:// or https://"
    exit 1
fi

# Check if curl is available
if ! command -v curl &> /dev/null; then
    print_error "curl is not installed. Please install curl to use this script."
    exit 1
fi

# Check if python3 is available (for JSON formatting)
if ! command -v python3 &> /dev/null; then
    print_warning "python3 not found. JSON responses will not be formatted."
fi

print_info "Configuration:"
print_info "  Pack ID: $PACK_ID"
print_info "  Endpoint: $ENDPOINT"
print_info "  Access Token: ${ACCESS_TOKEN:0:20}...${ACCESS_TOKEN: -10}"
echo ""

# Run the test
test_purchase_token_pack "$PACK_ID" "$ACCESS_TOKEN" "$ENDPOINT"

# Exit with appropriate code
if [ $? -eq 0 ]; then
    exit 0
else
    exit 1
fi
