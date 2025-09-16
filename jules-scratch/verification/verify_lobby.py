import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        import os
        file_path = "file://" + os.path.abspath('index.html')
        print(f"Navigating to {file_path}")
        await page.goto(file_path)

        print("Waiting for the main header to be visible...")
        header = page.locator("h1")

        await expect(header).to_be_visible(timeout=10000)
        await expect(header).to_have_text("Flagged")
        print("Header is visible and has the correct text.")

        initial_message = page.locator("#initial-message")
        await expect(initial_message).to_be_visible()
        print("Initial message is visible.")

        screenshot_path = "jules-scratch/verification/verification.png"
        await page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
