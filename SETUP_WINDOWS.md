# Windows Setup Guide - PowerShell Execution Policy Fix

A guide to fix PowerShell execution policy issues on Windows.

---

## Problem
If you see this error:
```
npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running scripts is disabled on this system.
```

This is a Windows PowerShell security feature blocking script execution.

## Solution Options

### Option 1: Use Command Prompt (CMD) Instead (Easiest)

1. Press `Win + R` to open Run dialog
2. Type `cmd` and press Enter
3. Navigate to the project folder:
   ```cmd
   cd C:\Users\amare\Downloads\imagechain_-secure-image-version-control
   ```
4. Run npm commands normally:
   ```cmd
   npm install
   npm run dev
   ```

### Option 2: Change PowerShell Execution Policy (One-Time Setup)

**Run PowerShell as Administrator:**

1. Right-click on Start button → Select "Windows PowerShell (Admin)" or "Terminal (Admin)"
2. Run this command to allow scripts for current user:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
3. Type `Y` when prompted
4. Close and reopen PowerShell
5. Now you can run `npm install` normally

### Option 3: Bypass for Current Session Only

In your current PowerShell window, run:
```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
```

Then run:
```powershell
npm install
```

This only affects the current PowerShell session and is the safest temporary fix.

---

## Recommended: Use Command Prompt

For this project, I recommend using **Command Prompt (CMD)** instead of PowerShell to avoid execution policy issues entirely.

### Steps:
1. Open Command Prompt (Win + R → type `cmd` → Enter)
2. Navigate to project:
   ```cmd
   cd C:\Users\amare\Downloads\imagechain_-secure-image-version-control
   ```
3. Install dependencies:
   ```cmd
   npm install
   ```
4. Start the app:
   ```cmd
   npm run dev
   ```

Command Prompt doesn't have execution policy restrictions, so npm will work without any issues.

