import puppeteer from "puppeteer";
import fs from "fs";

async function fetchAndSaveCurrentGameweekFixtures() {
    console.log("Navigating to Premier League matches page...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();

    await page.goto("https://www.premierleague.com/matches", { waitUntil: "networkidle2" });

    // Wait for matchweek title
    await page.waitForSelector(".fixtures__title", { timeout: 15000 });

    // Get matchweek number
    const matchweek = await page.evaluate(() => {
        const titleEl = document.querySelector(".fixtures__title");
        if (!titleEl) return null;
        const match = titleEl.textContent.match(/Matchweek\s+(\d+)/);
        return match ? match[1] : null;
    });

    if (!matchweek) throw new Error("Could not determine current matchweek");
    console.log(`Current matchweek: ${matchweek}`);

    // Extract fixtures
    const fixtures = await page.evaluate(() => {
        const games = [];
        document.querySelectorAll(".fixtures__matches-list .fixture").forEach(el => {
            const home = el.querySelector(".team.home .teamName")?.textContent?.trim();
            const away = el.querySelector(".team.away .teamName")?.textContent?.trim();
            const date = el.querySelector(".fixture__date")?.textContent?.trim();
            if (home && away) {
                games.push({ home, away, date });
            }
        });
        return games;
    });

    await browser.close();

    // Save to JSON
    const outputPath = "./public/upcoming-fixtures.json";
    fs.writeFileSync(outputPath, JSON.stringify({ matchweek, fixtures }, null, 2));
    console.log(`Fixtures for Matchweek ${matchweek} saved to ${outputPath}`);

    return { matchweek, fixtures };
}

// Example usage at start of your script
console.log("Fetching fixtures...");
const { matchweek, fixtures } = await fetchAndSaveCurrentGameweekFixtures();
// Your betting analysis logic continues here...
