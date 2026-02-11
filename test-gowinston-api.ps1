# GoWinston API v2 Direct Test Script (PowerShell)
# Tests the official GoWinston API directly with image URLs
# 
# API Documentation: https://docs.gowinston.ai
# Endpoint: https://api.gowinston.ai/v2/image-detection
# 
# Usage:
#   .\test-gowinston-api.ps1
#   .\test-gowinston-api.ps1 -ImageUrl "https://example.com/image.jpg"
#   .\test-gowinston-api.ps1 -ImageUrl "https://example.com/image.jpg" -Version "v2"

param(
    [string]$ImageUrl = "https://images.unsplash.com/photo-1541963463532-d68292c34d19",
    [string]$Version = "v1"
)

# ============================================
# CONFIGURATION
# ============================================

# GoWinston API Token
$API_TOKEN = "wTjZAXEt9uz3RJe9W9DVkTY9GLb0M2xrPxLKryO2d43986e4"

# API Endpoint
$API_ENDPOINT = "https://api.gowinston.ai/v2/image-detection"

# ============================================
# VALIDATE URL
# ============================================

if ($ImageUrl -notmatch "^https?://") {
    Write-Host ""
    Write-Host "❌ Error: Invalid image URL" -ForegroundColor Red
    Write-Host "   URL must start with http:// or https://" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Usage: .\test-gowinston-api.ps1 -ImageUrl `"https://example.com/image.jpg`" -Version `"v1`""
    Write-Host ""
    exit 1
}

# ============================================
# DISPLAY TEST INFORMATION
# ============================================

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "GoWinston API v2 Test" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Endpoint:    $API_ENDPOINT"
Write-Host "Image URL:   $ImageUrl"
Write-Host "Version:     $Version"
Write-Host "Token:       $($API_TOKEN.Substring(0, 10))...$($API_TOKEN.Substring($API_TOKEN.Length - 4))"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Sending request..." -ForegroundColor Yellow
Write-Host ""

# ============================================
# PREPARE REQUEST BODY
# ============================================

$body = @{
    url = $ImageUrl
    version = $Version
} | ConvertTo-Json

# ============================================
# MAKE API REQUEST
# ============================================

try {
    $response = Invoke-RestMethod `
        -Uri $API_ENDPOINT `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $API_TOKEN"
            "Content-Type" = "application/json"
        } `
        -Body $body `
        -TimeoutSec 60

    # ============================================
    # DISPLAY RESULTS
    # ============================================

    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "API RESPONSE:" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Pretty print the response
    $response | ConvertTo-Json -Depth 10 | Write-Host
    
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "✅ SUCCESS - HTTP 200" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host ""
    
    exit 0

} catch {
    # ============================================
    # HANDLE ERRORS
    # ============================================

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Red
    Write-Host "❌ ERROR - Request failed" -ForegroundColor Red
    Write-Host "==========================================" -ForegroundColor Red
    Write-Host ""
    
    Write-Host "Error Message: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status Code: $statusCode" -ForegroundColor Red
        
        # Try to read error response body
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $errorBody = $reader.ReadToEnd()
            Write-Host ""
            Write-Host "==========================================" -ForegroundColor Yellow
            Write-Host "API RESPONSE:" -ForegroundColor Yellow
            Write-Host "==========================================" -ForegroundColor Yellow
            Write-Host ""
            $errorBody | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Write-Host
        } catch {
            Write-Host "Could not read error response body" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Red
    Write-Host "Request failed" -ForegroundColor Red
    Write-Host "==========================================" -ForegroundColor Red
    Write-Host ""
    
    exit 1
}
