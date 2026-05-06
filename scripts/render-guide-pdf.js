const { createRequire } = require("module");
const path = require("path");
const { pathToFileURL } = require("url");

const runtimeRequire = createRequire(
  "/Users/betswang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/"
);
const { chromium } = runtimeRequire("playwright");

const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "our-favorite-spots-singapore.html");
const pdfPath = path.join(root, "our-favorite-spots-singapore.pdf");
const screenshotPath = path.join(root, "our-favorite-spots-singapore-preview.png");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const page = await browser.newPage({ viewport: { width: 1056, height: 816 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "print" });

  await page.pdf({
    path: pdfPath,
    format: "Letter",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
    tagged: true,
  });

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });

  const links = await page.$$eval("a[href]", (anchors) => anchors.map((a) => a.href));
  console.log(JSON.stringify({ pdfPath, screenshotPath, links }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
