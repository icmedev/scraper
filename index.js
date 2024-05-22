import { startSession, closeSession } from "./module/chromium.js";
import puppeteer from "puppeteer-extra";
import { notice, sleep } from "./module/general.js";
import { checkStat } from "./module/turnstile.js";
import { protectPage, protectedBrowser } from "puppeteer-afp";
import { puppeteerRealBrowser } from "./module/old.js";
export { puppeteerRealBrowser };
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import "dotenv/config";
puppeteer.use(StealthPlugin());
async function handleNewPage({ page, config = {} }) {
  // fp(page);
  protectPage(page, {
    webRTCProtect: false,
    ...config,
  });
  return page;
}

export const connect = ({
  args = [],
  headless = "auto",
  customConfig = {},
  proxy = {},
  skipTarget = [],
  fingerprint = false,
  turnstile = false,
  connectOption = {},
  fpconfig = {},
}) => {
  return new Promise(async (resolve, reject) => {
    var global_target_status = false;

    function targetFilter({ target, skipTarget }) {
      if (global_target_status === false) {
        return true;
      }
      var response = false;
      try {
        response = !!target.url();
        if (skipTarget.find((item) => String(target.url()).indexOf(String(item) > -1))) {
          response = true;
        }
      } catch (err) {}
      return response;
    }

    const setTarget = ({ status = true }) => {
      global_target_status = status;
    };

    const { chromeSession, cdpSession, chrome, xvfbsession } = await startSession({
      args: args,
      headless: headless,
      customConfig: customConfig,
      proxy: proxy,
    });

    const browser = await puppeteer.connect({
      targetFilter: (target) => targetFilter({ target: target, skipTarget: skipTarget }),
      browserWSEndpoint: chromeSession.browserWSEndpoint,
      ...connectOption,
    });

    var page = await browser.pages();

    page = page[0];

    setTarget({ status: true });

    if (proxy && proxy.username && proxy.username.length > 0) {
      await page.authenticate({ username: proxy.username, password: proxy.password });
    }

    var solve_status = true;

    const setSolveStatus = ({ status }) => {
      solve_status = status;
    };

    const autoSolve = ({ page }) => {
      return new Promise(async (resolve, reject) => {
        while (solve_status) {
          try {
            await sleep(1500);
            await checkStat({ page: page }).catch((err) => {});
          } catch (err) {}
        }
        resolve();
      });
    };

    if (fingerprint === true) {
      handleNewPage({ page: page, config: fpconfig });
    }
    if (turnstile === true) {
      setSolveStatus({ status: true });
      autoSolve({ page: page, browser: browser });
    }

    await page.setUserAgent(chromeSession.agent);

    await page.setViewport({
      width: 1920,
      height: 1080,
    });

    browser.on("disconnected", async () => {
      notice({
        message: "Browser Disconnected",
        type: "info",
      });
      try {
        setSolveStatus({ status: false });
      } catch (err) {}
      await closeSession({
        xvfbsession: xvfbsession,
        cdpSession: cdpSession,
        chrome: chrome,
      }).catch((err) => {
        console.log(err.message);
      });
    });

    browser.on("targetcreated", async (target) => {
      var newPage = await target.page();

      try {
        await newPage.setUserAgent(chromeSession.agent);
      } catch (err) {
        // console.log(err.message);
      }

      try {
        await newPage.setViewport({
          width: 1920,
          height: 1080,
        });
      } catch (err) {
        // console.log(err.message);
      }

      if (newPage && fingerprint === true) {
        try {
          handleNewPage({ page: newPage, config: fpconfig });
        } catch (err) {}
      }

      if (turnstile === true) {
        autoSolve({ page: newPage });
      }
    });

    resolve({
      browser: browser,
      page: page,
      xvfbsession: xvfbsession,
      cdpSession: cdpSession,
      chrome: chrome,
      setTarget: setTarget,
    });
  });
};
import express from "express";

const app = express();

app.get("/", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("Please provide a URL");
  }

  if (typeof url !== "string") {
    url = String(url);
  }

  const params = new URLSearchParams(req.query);
  for (const [key, value] of params.entries()) {
    if (key !== "url") {
      url += `&${key}=${encodeURIComponent(value)}`;
    }
  }

  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    return res.status(400).send("Please provide a valid URL");
  }

  try {
    const response = await connect({
      turnstile: true,
      fingerprint: true,
      headless: "auto",
      proxy: {
        host: process.env.PROXY_HOST,
        port: process.env.PROXY_PORT,
        username: process.env.PROXY_USERNAME,
        password: process.env.PROXY_PASSWORD,
      },
      customConfig: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      },
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--single-process", "--no-zygote"],
    });

    const { page, browser } = response;

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    await page.goto(url, {
      timeout: 0,
    });

    await page.waitForSelector("body");

    const html = await page.evaluate(() => document.documentElement.outerHTML);

    res.send(html);

    await browser.close();
  } catch (error) {
    res.send(error);
  }
});

app.listen(3000, () => {
  console.log("Server started on port 3000");
});
