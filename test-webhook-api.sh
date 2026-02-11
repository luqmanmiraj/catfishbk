#!/bin/bash

# RevenueCat Webhook API Test Script
# Tests the webhook endpoint with mock RevenueCat events
# 
# Usage:
#   ./test-webhook-api.sh [event-type] [user-id] [endpoint-url]
#
# Examples:
#   ./test-webhook-api.sh INITIAL_PURCHASE user123
#   ./test-webhook-api.sh RENEWAL user123 https://your-api.execute-api.us-east-1.amazonaws.com/dev/webhook
#   ./test-webhook-api.sh all
#
# Environment Variables:
#   REVENUECAT_SECRET_KEY - Secret key for signature generation (optional)
#   WEBHOOK_ENDPOINT - Default webhook endpoint URL (optional)

# ============================================
# CONFIGURATION
# ============================================

# Default webhook endpoint (update with your actual endpoint)
DEFAULT_ENDPOINT="${WEBHOOK_ENDPOINT:-https://3oaimkf4g6.execute-api.us-east-1.amazonaws.com/dev/webhook}"

# Default test values
DEFAULT_EVENT_TYPE="INITIAL_PURCHASE"
DEFAULT_USER_ID="test-user-$(date +%s)"

# RevenueCat secret key (for signature generation)
SECRET_KEY="${REVENUECAT_SECRET_KEY:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# HELPER FUNCTIONS
# ============================================

# Print colored output
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

# Generate HMAC SHA256 signature
generate_signature() {
    local body="$1"
    local secret_key="$2"
    
    if [ -z "$secret_key" ]; then
        echo ""
        return
    fi
    
    # Generate HMAC SHA256 signature using openssl
    echo -n "$body" | openssl dgst -sha256 -hmac "$secret_key" | sed 's/^.* //'
}

# Create webhook payload JSON
create_webhook_payload() {
    local event_type="$1"
    local user_id="$2"
    
    # Get current timestamp in milliseconds
    local now_ms=$(($(date +%s) * 1000))
    local expires_at_ms=$((now_ms + (30 * 24 * 60 * 60 * 1000))) # 30 days from now
    
    # Convert to ISO dates
    local now_iso=$(date -u -d "@$((now_ms / 1000))" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -j -f "%s" "$((now_ms / 1000))" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    local expires_iso=$(date -u -d "@$((expires_at_ms / 1000))" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -j -f "%s" "$((expires_at_ms / 1000))" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    
    # Determine entitlements based on event type
    local entitlements_json="{}"
    local entitlement_ids_json="[]"
    
    case "$event_type" in
        INITIAL_PURCHASE|RENEWAL|UNCANCELLATION|CANCELLATION|BILLING_ISSUE)
            entitlements_json="{\"pro\":{\"expires_date\":\"$expires_iso\",\"product_identifier\":\"catfish_pro_monthly\",\"purchase_date\":\"$now_iso\"}}"
            entitlement_ids_json="[\"pro\"]"
            ;;
        EXPIRATION)
            entitlements_json="{}"
            entitlement_ids_json="[]"
            ;;
        *)
            entitlements_json="{}"
            entitlement_ids_json="[]"
            ;;
    esac
    
    # Create the event JSON
    cat <<EOF
{
  "event": {
    "id": "test-event-$now_ms",
    "event_timestamp_ms": $now_ms,
    "product_id": "catfish_pro_monthly",
    "period_type": "NORMAL",
    "purchased_at_ms": $now_ms,
    "expiration_at_ms": $expires_at_ms,
    "environment": "SANDBOX",
    "entitlement_ids": $entitlement_ids_json,
    "transaction_id": "test-txn-$now_ms",
    "original_transaction_id": "test-txn-$now_ms",
    "is_family_share": false,
    "country_code": "US",
    "app_user_id": "$user_id",
    "original_app_user_id": "$user_id",
    "aliases": ["\$RCAnonymousID:$user_id"],
    "currency": "USD",
    "price": 9.99,
    "price_in_purchased_currency": 9.99,
    "store": "APP_STORE",
    "type": "$event_type",
    "app_id": "test-app-id",
    "subscriber_attributes": {
      "\$email": {
        "updated_at_ms": $now_ms,
        "value": "$user_id@example.com"
      }
    },
    "entitlements": $entitlements_json
  },
  "api_version": "1.0"
}
EOF
}

# Test webhook with specific event type
test_webhook() {
    local event_type="$1"
    local user_id="$2"
    local endpoint="$3"
    local include_signature="${4:-true}"
    local custom_signature="${5:-}"
    
    echo ""
    echo "============================================================"
    echo "TESTING REVENUECAT WEBHOOK HANDLER"
    echo "============================================================"
    print_info "Event Type: $event_type"
    print_info "User ID: $user_id"
    print_info "Endpoint: $endpoint"
    echo ""
    
    # Create payload
    local payload=$(create_webhook_payload "$event_type" "$user_id")
    
    # Generate signature
    local signature=""
    if [ "$include_signature" = "true" ] && [ -n "$SECRET_KEY" ]; then
        signature=$(generate_signature "$payload" "$SECRET_KEY")
        print_info "Signature generated (using secret key)"
    elif [ -n "$custom_signature" ]; then
        signature="$custom_signature"
        print_info "Using custom signature: $custom_signature"
    else
        print_warning "No signature (secret key not set or signature disabled)"
    fi
    
    # Display payload (first 500 chars)
    print_info "Payload (preview):"
    echo "$payload" | head -c 500
    echo "..."
    echo ""
    
    # Prepare headers
    local headers=(-H "Content-Type: application/json")
    if [ -n "$signature" ]; then
        headers+=(-H "X-RevenueCat-Signature: $signature")
    fi
    headers+=(-H "X-RevenueCat-Event-Name: $event_type")
    
    # Make the request
    print_info "Sending webhook request..."
    echo ""
    
    local response=$(curl -s -w "\n%{http_code}" -X POST "$endpoint" \
        "${headers[@]}" \
        -d "$payload")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    # Display results
    echo "============================================================"
    echo "RESPONSE"
    echo "============================================================"
    print_info "HTTP Status Code: $http_code"
    echo ""
    
    if [ "$http_code" = "200" ]; then
        print_success "SUCCESS - Webhook processed successfully"
    elif [ "$http_code" = "401" ]; then
        print_error "UNAUTHORIZED - Invalid signature"
    elif [ "$http_code" = "400" ]; then
        print_error "BAD REQUEST - Invalid payload"
    elif [ "$http_code" = "500" ]; then
        print_error "SERVER ERROR - Check server logs"
    else
        print_warning "Unexpected status code: $http_code"
    fi
    
    echo ""
    print_info "Response Body:"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    echo ""
    echo "============================================================"
    echo ""
    
    return $([ "$http_code" = "200" ] && echo 0 || echo 1)
}

# Test webhook without signature
test_webhook_no_signature() {
    local event_type="$1"
    local user_id="$2"
    local endpoint="$3"
    
    echo ""
    echo "============================================================"
    echo "TESTING WEBHOOK WITHOUT SIGNATURE"
    echo "============================================================"
    
    test_webhook "$event_type" "$user_id" "$endpoint" "false"
}

# Test webhook with invalid signature
test_webhook_invalid_signature() {
    local event_type="$1"
    local user_id="$2"
    local endpoint="$3"
    
    echo ""
    echo "============================================================"
    echo "TESTING WEBHOOK WITH INVALID SIGNATURE"
    echo "============================================================"
    
    test_webhook "$event_type" "$user_id" "$endpoint" "true" "invalid-signature-12345"
}

# Run all tests
run_all_tests() {
    local user_id="${1:-$DEFAULT_USER_ID}"
    local endpoint="${2:-$DEFAULT_ENDPOINT}"
    
    echo ""
    echo "🧪 Running comprehensive webhook tests..."
    echo ""
    
    local event_types=("INITIAL_PURCHASE" "RENEWAL" "CANCELLATION" "EXPIRATION" "BILLING_ISSUE" "UNCANCELLATION")
    local results=()
    
    for event_type in "${event_types[@]}"; do
        echo "📋 Testing $event_type..."
        if test_webhook "$event_type" "$user_id" "$endpoint"; then
            results+=("✅ $event_type")
        else
            results+=("❌ $event_type")
        fi
        sleep 0.5
    done
    
    # Test signature validation
    echo ""
    echo "📋 Testing signature validation..."
    test_webhook_no_signature "INITIAL_PURCHASE" "$user_id" "$endpoint"
    test_webhook_invalid_signature "INITIAL_PURCHASE" "$user_id" "$endpoint"
    
    # Summary
    echo ""
    echo "============================================================"
    echo "TEST SUMMARY"
    echo "============================================================"
    for result in "${results[@]}"; do
        echo "$result"
    done
    echo "============================================================"
    echo ""
}

# ============================================
# MAIN SCRIPT
# ============================================

# Parse arguments
EVENT_TYPE="${1:-$DEFAULT_EVENT_TYPE}"
USER_ID="${2:-$DEFAULT_USER_ID}"
ENDPOINT="${3:-$DEFAULT_ENDPOINT}"

# Check if running all tests
if [ "$EVENT_TYPE" = "all" ] || [ "$EVENT_TYPE" = "ALL" ]; then
    run_all_tests "$USER_ID" "$ENDPOINT"
    exit 0
fi

# Display configuration
echo "============================================================"
echo "REVENUECAT WEBHOOK API TEST"
echo "============================================================"
echo ""

# Check for secret key
if [ -n "$SECRET_KEY" ]; then
    local key_preview="${SECRET_KEY:0:10}...${SECRET_KEY: -4}"
    print_success "REVENUECAT_SECRET_KEY found (signature verification enabled)"
    print_info "   Key preview: $key_preview"
else
    print_warning "REVENUECAT_SECRET_KEY not set (signature verification disabled)"
    print_info "   Webhook will accept requests without signature verification"
    print_info "   Set REVENUECAT_SECRET_KEY environment variable to test signature verification"
fi

echo ""
print_info "Configuration:"
print_info "  Event Type: $EVENT_TYPE"
print_info "  User ID: $USER_ID"
print_info "  Endpoint: $ENDPOINT"
echo ""

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

# Check if openssl is available (for signature generation)
if [ -n "$SECRET_KEY" ] && ! command -v openssl &> /dev/null; then
    print_warning "openssl is not installed. Signature generation will be skipped."
    print_info "Install openssl to test signature verification:"
    print_info "  Ubuntu/Debian: sudo apt-get install openssl"
    print_info "  macOS: openssl is pre-installed"
    print_info "  Windows: Install Git Bash or use WSL"
fi

# Run the test
test_webhook "$EVENT_TYPE" "$USER_ID" "$ENDPOINT"

# Exit with appropriate code
if [ $? -eq 0 ]; then
    exit 0
else
    exit 1
fi
