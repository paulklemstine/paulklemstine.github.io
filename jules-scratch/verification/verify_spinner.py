import asyncio
from playwright.async_api import async_playwright, expect
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        html_file_path = os.path.abspath('index.html')
        await page.goto(f'file://{html_file_path}')

        # Wait for a fixed time to let the page initialize.
        # This is not ideal, but the auto-login logic is hard to predict.
        await page.wait_for_timeout(3000)

        # Set the necessary global state for the spinner to work
        await page.evaluate("window.amIPlayer1 = true")

        # --- Test Case 1: First-Turn Minigame Spinner ---
        await page.evaluate("startSpinner('scenes', null)")
        spinner_modal = page.locator("#spinner-modal")
        await expect(spinner_modal).to_be_visible()
        await expect(page.locator("#spinner-modal .spinner-segment")).to_have_count(12, timeout=5000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path="jules-scratch/verification/verification.png")
        print("Screenshot 'verification.png' taken.")

        # --- Test Case 2: Non-interactive Loading Spinner ---
        await page.evaluate("document.getElementById('spinner-modal').style.display = 'none'")
        await page.evaluate("setLoading(true, false)")
        interstitial_screen = page.locator("#interstitial-screen")
        await expect(interstitial_screen).to_be_visible()
        interstitial_wheel = page.locator("#interstitial-spinner-wheel")
        await expect(interstitial_wheel).to_be_visible()
        await page.screenshot(path="jules-scratch/verification/loading_spinner.png")
        print("Screenshot 'loading_spinner.png' taken.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
