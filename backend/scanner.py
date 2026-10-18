import sys
import json
import requests
import argparse
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from axe_playwright_python.sync_playwright import Axe

def run_robust_scan(target_url, github_owner, github_repo, file_path, output_filename="scan_results.json"):
    print(f"Starting robust accessibility scan on: {target_url}")
    print(f"Target Repository: {github_owner}/{github_repo} | File: {file_path}")
    
    axe = Axe()
    extracted_errors = []
    
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()
            
            try:
                page.goto(target_url, timeout=30000, wait_until="domcontentloaded")
            except PlaywrightTimeoutError:
                print(f"CRITICAL ERROR: Timed out while trying to load {target_url}.")
                browser.close()
                sys.exit(1)
            except Exception as nav_err:
                print(f"CRITICAL ERROR: Failed to navigate to {target_url}. Details: {nav_err}")
                browser.close()
                sys.exit(1)
            
            print("Page loaded successfully. Running axe-core engine...")
            
            try:
                results = axe.run(page)
            except Exception as scan_err:
                print(f"CRITICAL ERROR: Axe-core scan failed to execute. Details: {scan_err}")
                browser.close()
                sys.exit(1)
                
            browser.close()
            
            raw_violations = []
            if hasattr(results, 'response') and isinstance(results.response, dict):
                raw_violations = results.response.get("violations", [])
            else:
                print("CRITICAL ERROR: Unexpected axe-core result structure.")
                sys.exit(1)

            print(f"Scan complete. Found {len(raw_violations)} total violations.")
            
            for violation in raw_violations:
                extracted_errors.append({
                    "issue_id": violation.get('id', 'unknown_id'),
                    "impact": violation.get('impact', 'unknown_impact'),
                    "description": violation.get('description', 'No description provided'),
                    "help_url": violation.get('helpUrl', 'No help URL'),
                    "failed_code": [node.get('html', '') for node in violation.get('nodes', [])]
                })

    except Exception as fatal_err:
        print(f"FATAL SYSTEM ERROR during Playwright execution: {fatal_err}")
        sys.exit(1)
        
    try:
        with open(output_filename, "w", encoding="utf-8") as json_file:
            json.dump(extracted_errors, json_file, indent=4)
        print(f"SUCCESS: Data saved securely to {output_filename}")
    except IOError as io_err:
        print(f"CRITICAL ERROR: Failed to write output file {output_filename}. Details: {io_err}")
        sys.exit(1)

    n8n_webhook_url = "http://localhost:5678/webhook-test/09a3f938-92e0-4238-9acf-868686dd8858"
    print(f"Sending dynamic payload to n8n at: {n8n_webhook_url}")

    # The payload now includes all dynamic GitHub variables
    payload = {
        "scanned_url": target_url,
        "github_owner": github_owner,
        "github_repo": github_repo,
        "file_path": file_path,
        "total_violations": len(extracted_errors),
        "violations": extracted_errors
    }

    try:
        response = requests.post(n8n_webhook_url, json=payload, timeout=10)
        print(f"SUCCESS: Payload received by n8n! (HTTP {response.status_code})")
    except requests.exceptions.ConnectionError:
        print("ERROR: Could not connect to n8n. Ensure Docker is running on port 5678.")
    except Exception as post_err:
        print(f"ERROR: Failed to dispatch data to n8n: {post_err}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Accessibility Scanner to n8n Pipeline")
    parser.add_argument("--url", required=True, help="Target website URL to scan")
    parser.add_argument("--owner", required=True, help="GitHub repository owner username")
    parser.add_argument("--repo", required=True, help="GitHub repository name")
    parser.add_argument("--file", required=True, help="File path in the repository (e.g., src/App.jsx)")
    
    args = parser.parse_args()
    run_robust_scan(args.url, args.owner, args.repo, args.file)