import sys
import json
import argparse
if __package__:
    from .scanner_platform import install_child_limits, PlatformError, CONTAINMENT_EXIT, MAX_CHILD_FILE_BYTES
else:
    from scanner_platform import install_child_limits, PlatformError, CONTAINMENT_EXIT, MAX_CHILD_FILE_BYTES

if __name__ == "__main__":
    try:
        install_child_limits()
    except (PlatformError, OSError):
        sys.exit(CONTAINMENT_EXIT)

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from axe_playwright_python.sync_playwright import Axe

def run_robust_scan(target_url, github_owner="", github_repo="", file_path="", output_filename="audit.json", proxy_url=None):
    if not proxy_url:
        raise ValueError("A guarded scan proxy is required")
    print("Starting accessibility scan")
    
    axe = Axe()
    
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, chromium_sandbox=True,
                proxy={"server": proxy_url, "bypass": "<-loopback>"},
                args=["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                      "--host-resolver-rules=MAP * ~NOTFOUND"])
            context = browser.new_context(service_workers="block", accept_downloads=False)
            def guard(route):
                from urllib.parse import urlsplit
                if (route.request.method not in ("GET", "HEAD")
                        or urlsplit(route.request.url).scheme not in ("http", "https")):
                    return route.abort()
                return route.continue_()
            context.route("**/*", guard)
            context.route_web_socket("**/*", lambda ws: ws.close())
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
            
    except Exception as fatal_err:
        print(f"FATAL SYSTEM ERROR during Playwright execution: {fatal_err}")
        sys.exit(1)
        
    try:
        with open(output_filename, "w", encoding="utf-8", newline="\n") as json_file:
            payload = json.dumps(results.response, indent=2, allow_nan=False)
            if len(payload.encode("utf-8")) > MAX_CHILD_FILE_BYTES:
                raise ValueError("Scanner report exceeds the file limit")
            json_file.write(payload)
        print(f"SUCCESS: Data saved securely to {output_filename}")
    except (OSError, ValueError, TypeError) as io_err:
        print(f"CRITICAL ERROR: Failed to write output file {output_filename}. Details: {io_err}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Guarded axe-core accessibility scanner")
    parser.add_argument("--url", required=True, help="Target website URL to scan")
    parser.add_argument("--owner", default="", help="GitHub repository owner username")
    parser.add_argument("--repo", default="", help="GitHub repository name")
    parser.add_argument("--file", default="", help="File path in the repository (e.g., src/App.jsx)")
    
    parser.add_argument("--output", default="audit.json")
    parser.add_argument("--proxy", required=True)
    args = parser.parse_args()
    run_robust_scan(args.url, args.owner, args.repo, args.file, args.output, args.proxy)
