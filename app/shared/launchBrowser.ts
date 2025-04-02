import path from "path"
import puppeteer, { Browser } from "puppeteer"

type LaunchOptionsArgs = `--${string}`
interface LaunchOptions {
	headless?: boolean
	executablePath?: string
	args?: LaunchOptionsArgs[]
	protocolTimeout?: number
	timeout?: number
	defaultViewport?: {
		width?: number
		height?: number
	}
	ignoreDefaultArgs?: LaunchOptionsArgs[]
}

async function launchBrowser(options: LaunchOptions) {
	const browserPath = path.join(process.cwd(), "browser\\chrome-win64\\chrome.exe")
	try {
		return (await puppeteer.launch({
			headless: options.headless ?? true,
			executablePath: options.executablePath ?? browserPath,
			args: [
				...(options.args ?? [
					"--no-sandbox",
					"--disable-setuid-sandbox",
					"--disable-dev-shm-usage",
					"--lang=en-US,en",
					"--disable-features=site-per-process",
					"--disable-web-security",
					"--ignore-certificate-errors",
					"--disable-blink-features=AutomationControlled",
					"--window-size=1920,1080",
					"--disable-notifications",
					"--disable-infobars",
					"--disable-extensions",
					"--enable-features=NetworkService,NetworkServiceInProcess",
					"--disable-background-timer-throttling",
					"--disable-backgrounding-occluded-windows",
					"--disable-breakpad",
					"--disable-component-extensions-with-background-pages",
					"--disable-features=TranslateUI,BlinkGenPropertyTrees",
					"--disable-ipc-flooding-protection",
					"--disable-renderer-backgrounding",
					"--hide-scrollbars",
				]),
			],
			timeout: options.timeout ?? 120000,
			protocolTimeout: options.protocolTimeout ?? 60000,
			defaultViewport: {
				width: options.defaultViewport?.width ?? 1366,
				height: options.defaultViewport?.height ?? 768,
			},
			ignoreDefaultArgs: options.ignoreDefaultArgs ?? ["--enable-automation"],
		})) as Browser
	} catch (error) {
		console.log(`❌ | Ошибка при запуске браузера ${error!.toString()}`)
		throw error
	}
}

export default launchBrowser
export type { Browser, LaunchOptions, LaunchOptionsArgs }
