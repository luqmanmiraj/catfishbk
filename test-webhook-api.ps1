# RevenueCat Webhook API Test Script (PowerShell)
# Tests the webhook endpoint with mock RevenueCat events
# 
# Usage:
#   .\test-webhook-api.ps1
#   .\test-webhook-api.ps1 -EventType INITIAL_PURCHASE -UserId user123
#   .\test-webhook-api.ps1 -EventType INITIAL_PURCHASE -UserId user123 -Endpoint "https://your-api.execute-api.us-east-1.amazonaws.com/dev/webhook"
#   .\test-webhook-api.ps1 -EventType all
#
# Environment Variables:
#   $env:REVENUECAT_SECRET_KEY - Secret key for signature generation (optional)
#   $env:WEBHOOK_ENDPOINT - Default webhook endpoint URL (optional)

param(
    [string]$EventType = "INITIAL_PURCHASE",
    [string]$UserId = "test-user-$(Get-Date -Format 'yyyyMMddHHmmss')",
    [string]$Endpoint = $env:WEBHOOK_ENDPOINT
)

# ============================================
# CONFIGURATION
# ============================================

# Default webhook endpoint (update with your actual endpoint)
if ([string]::IsNullOrEmpty($Endpoint)) {
    $Endpoint = "https://3oaimkf4g6.execute-api.us-east-1.amazonaws.com/dev/webhook"
}

# RevenueCat secret key (for signature generation)
$SecretKey = $env:REVENUECAT_SECRET_KEY

# ============================================
# HELPER FUNCTIONS
# ============================================

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

# Generate HMAC SHA256 signature
function Generate-Signature {
    param(
        [string]$Body,
        [string]$SecretKey
    )
    
    if ([string]::IsNullOrEmpty($SecretKey)) {
        return ""
    }
    
    # Generate HMAC SHA256 signature using .NET
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($SecretKey)
    $hash = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Body))
    $signature = [System.BitConverter]::ToString($hash).Replace("-", "").ToLower()
    
    return $signature
}

# Create webhook payload JSON
function Create-WebhookPayload {
    param(
        [string]$EventType,
        [string]$UserId
    )
    
    # Get current timestamp in milliseconds
    $now = Get-Date
    $nowMs = [long]($now.ToUniversalTime() - (Get-Date "1970-01-01")).TotalMilliseconds
    $expiresAtMs = $nowMs + (30 * 24 * 60 * 60 * 1000) # 30 days from now
    
    # Convert to ISO dates
    $nowIso = $now.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $expiresIso = $now.AddDays(30).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    
    # Determine entitlements based on event type
    $entitlementsJson = "{}"
    $entitlementIdsJson = "[]"
    
    switch ($EventType) {
        { $_ -in @("INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "CANCELLATION", "BILLING_ISSUE") } {
            $entitlementsJson = @{
                pro = @{
                    expires_date = $expiresIso
                    product_identifier = "catfish_pro_monthly"
                    purchase_date = $nowIso
                }
            } | ConvertTo-Json -Compress
            $entitlementIdsJson = '["pro"]'
        }
        "EXPIRATION" {
            $entitlementsJson = "{}"
            $entitlementIdsJson = "[]"
        }
        default {
            $entitlementsJson = "{}"
            $entitlementIdsJson = "[]"
        }
    }
    
    # Create the event object
    $event = @{
        id = "test-event-$nowMs"
        event_timestamp_ms = $nowMs
        product_id = "catfish_pro_monthly"
        period_type = "NORMAL"
        purchased_at_ms = $nowMs
        expiration_at_ms = $expiresAtMs
        environment = "SANDBOX"
        entitlement_ids = ($entitlementIdsJson | ConvertFrom-Json)
        transaction_id = "test-txn-$nowMs"
        original_transaction_id = "test-txn-$nowMs"
        is_family_share = $false
        country_code = "US"
        app_user_id = $UserId
        original_app_user_id = $UserId
        aliases = @("`$RCAnonymousID:$UserId")
        currency = "USD"
        price = 9.99
        price_in_purchased_currency = 9.99
        store = "APP_STORE"
        type = $EventType
        app_id = "test-app-id"
        subscriber_attributes = @{
            '$email' = @{
                updated_at_ms = $nowMs
                value = "$UserId@example.com"
            }
        }
        entitlements = ($entitlementsJson | ConvertFrom-Json)
    }
    
    # Wrap in RevenueCat format
    $payload = @{
        event = $event
        api_version = "1.0"
    }
    
    return ($payload | ConvertTo-Json -Depth 10 -Compress:$false)
}

# Test webhook with specific event type
function Test-Webhook {
    param(
        [string]$EventType,
        [string]$UserId,
        [string]$Endpoint,
        [bool]$IncludeSignature = $true,
        [string]$CustomSignature = ""
    )
    
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "TESTING REVENUECAT WEBHOOK HANDLER" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Info "Event Type: $EventType"
    Write-Info "User ID: $UserId"
    Write-Info "Endpoint: $Endpoint"
    Write-Host ""
    
    # Create payload
    $payload = Create-WebhookPayload -EventType $EventType -UserId $UserId
    $payloadString = $payload | ConvertTo-Json -Depth 10 -Compress
    
    # Generate signature
    $signature = ""
    if ($IncludeSignature -and -not [string]::IsNullOrEmpty($SecretKey)) {
        $signature = Generate-Signature -Body $payloadString -SecretKey $SecretKey
        Write-Info "Signature generated (using secret key)"
    } elseif (-not [string]::IsNullOrEmpty($CustomSignature)) {
        $signature = $CustomSignature
        Write-Info "Using custom signature: $CustomSignature"
    } else {
        Write-Warning "No signature (secret key not set or signature disabled)"
    }
    
    # Display payload preview
    Write-Info "Payload (preview):"
    $payloadPreview = $payloadString.Substring(0, [Math]::Min(500, $payloadString.Length))
    Write-Host "$payloadPreview..."
    Write-Host ""
    
    # Prepare headers
    $headers = @{
        "Content-Type" = "application/json"
        "X-RevenueCat-Event-Name" = $EventType
    }
    
    if (-not [string]::IsNullOrEmpty($signature)) {
        $headers["X-RevenueCat-Signature"] = $signature
    }
    
    # Make the request
    Write-Info "Sending webhook request..."
    Write-Host ""
    
    try {
        $response = Invoke-RestMethod -Uri $Endpoint -Method Post -Headers $headers -Body $payloadString -ContentType "application/json" -ErrorAction Stop
        
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "RESPONSE" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Success "SUCCESS - Webhook processed successfully"
        Write-Host ""
        Write-Info "Response Body:"
        $response | ConvertTo-Json -Depth 10
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host ""
        
        return $true
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $errorBody = $_.ErrorDetails.Message
        
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "RESPONSE" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Info "HTTP Status Code: $statusCode"
        Write-Host ""
        
        if ($statusCode -eq 401) {
            Write-Error "UNAUTHORIZED - Invalid signature"
        } elseif ($statusCode -eq 400) {
            Write-Error "BAD REQUEST - Invalid payload"
        } elseif ($statusCode -eq 500) {
            Write-Error "SERVER ERROR - Check server logs"
        } else {
            Write-Warning "Unexpected status code: $statusCode"
        }
        
        Write-Host ""
        Write-Info "Error Details:"
        Write-Host $errorBody
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host ""
        
        return $false
    }
}

# Test webhook without signature
function Test-WebhookNoSignature {
    param(
        [string]$EventType,
        [string]$UserId,
        [string]$Endpoint
    )
    
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "TESTING WEBHOOK WITHOUT SIGNATURE" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    
    Test-Webhook -EventType $EventType -UserId $UserId -Endpoint $Endpoint -IncludeSignature $false
}

# Test webhook with invalid signature
function Test-WebhookInvalidSignature {
    param(
        [string]$EventType,
        [string]$UserId,
        [string]$Endpoint
    )
    
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "TESTING WEBHOOK WITH INVALID SIGNATURE" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    
    Test-Webhook -EventType $EventType -UserId $UserId -Endpoint $Endpoint -IncludeSignature $true -CustomSignature "invalid-signature-12345"
}

# Run all tests
function Run-AllTests {
    param(
        [string]$UserId,
        [string]$Endpoint
    )
    
    Write-Host ""
    Write-Host "🧪 Running comprehensive webhook tests..." -ForegroundColor Yellow
    Write-Host ""
    
    $eventTypes = @("INITIAL_PURCHASE", "RENEWAL", "CANCELLATION", "EXPIRATION", "BILLING_ISSUE", "UNCANCELLATION")
    $results = @()
    
    foreach ($eventType in $eventTypes) {
        Write-Host "📋 Testing $eventType..." -ForegroundColor Yellow
        if (Test-Webhook -EventType $eventType -UserId $UserId -Endpoint $Endpoint) {
            $results += "✅ $eventType"
        } else {
            $results += "❌ $eventType"
        }
        Start-Sleep -Milliseconds 500
    }
    
    # Test signature validation
    Write-Host ""
    Write-Host "📋 Testing signature validation..." -ForegroundColor Yellow
    Test-WebhookNoSignature -EventType "INITIAL_PURCHASE" -UserId $UserId -Endpoint $Endpoint
    Test-WebhookInvalidSignature -EventType "INITIAL_PURCHASE" -UserId $UserId -Endpoint $Endpoint
    
    # Summary
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "TEST SUMMARY" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    foreach ($result in $results) {
        Write-Host $result
    }
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
}

# ============================================
# MAIN SCRIPT
# ============================================

# Check if running all tests
if ($EventType -eq "all" -or $EventType -eq "ALL") {
    Run-AllTests -UserId $UserId -Endpoint $Endpoint
    exit 0
}

# Display configuration
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "REVENUECAT WEBHOOK API TEST" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Check for secret key
if (-not [string]::IsNullOrEmpty($SecretKey)) {
    $keyPreview = $SecretKey.Substring(0, [Math]::Min(10, $SecretKey.Length)) + "..." + $SecretKey.Substring([Math]::Max(0, $SecretKey.Length - 4))
    Write-Success "REVENUECAT_SECRET_KEY found (signature verification enabled)"
    Write-Info "   Key preview: $keyPreview"
} else {
    Write-Warning "REVENUECAT_SECRET_KEY not set (signature verification disabled)"
    Write-Info "   Webhook will accept requests without signature verification"
    Write-Info "   Set `$env:REVENUECAT_SECRET_KEY to test signature verification"
}

Write-Host ""
Write-Info "Configuration:"
Write-Info "  Event Type: $EventType"
Write-Info "  User ID: $UserId"
Write-Info "  Endpoint: $Endpoint"
Write-Host ""

# Validate endpoint URL
if ($Endpoint -notmatch "^https?://") {
    Write-Error "Invalid endpoint URL: $Endpoint"
    Write-Info "URL must start with http:// or https://"
    exit 1
}

# Run the test
$success = Test-Webhook -EventType $EventType -UserId $UserId -Endpoint $Endpoint

# Exit with appropriate code
if ($success) {
    exit 0
} else {
    exit 1
}
