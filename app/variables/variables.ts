type BrowserArgs = `--${string}`;

interface Variables<T> {
  url: T;
  ResultFileName: string;
  directory: string;
  browser?: {
    headless: boolean;
  };
  server: {
    host: string;
    port: number;
  };
  chunks: {
    ai: {
      timeout: number;
      maxAttempts: number;
      maxTokens: number;
      temperature: number;
      topP: number;
      frequencyPenalty: number;
      presencePenalty: number;
      leakedFileName: string;
      processedFileName: string;
      debugFileName: string;
    };
    filter: {
      keywords: ReadonlySet<string>[];
      outputFile: string;
    };
  };
}

class Config<T> implements Variables<T> {
  private static defaultConfig: Variables<string> = {
    url: "https://www.olx.uz/nedvizhimost/kvartiry/tashkent/?currency=UYE",
    ResultFileName: "result.json",
    directory: "./output",
    browser: {
      headless: true,
    },
    server: {
      host: "localhost",
      port: 3000,
    },
    chunks: {
      ai: {
        timeout: 5000,
        maxAttempts: 3,
        maxTokens: 1000,
        temperature: 0.7,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
        leakedFileName: "processed_data_leaked.json",
        processedFileName: "processed_data.json",
        debugFileName: "debug_processed_data.json",
      },
      filter: {
        keywords: [new Set(["default"])],
        outputFile: "filtered.json",
      },
    },
  };

  private config: Variables<T>;

  constructor(config: Partial<Variables<T>> = {} as Variables<T>) {
    this.config = {
      ...Config.defaultConfig,
      ...config,
      browser: { ...Config.defaultConfig.browser, ...config.browser }, // Гарантируем, что browser не undefined
    } as Variables<T>;
  }

  get url(): T {
    return this.config.url;
  }

  get ResultFileName(): string {
    return this.config.ResultFileName;
  }

  get directory(): string {
    return this.config.directory;
  }

  get server(): { host: string; port: number } {
    return this.config.server;
  }

  get chunks(): Variables<T>["chunks"] {
    return this.config.chunks;
  }

  // Методы для работы с конфигурацией как с объектом
  toJSON(): Variables<T> {
    return { ...this.config };
  }

  static fromJSON<T>(json: Partial<Variables<T>>): Config<T> {
    return new Config<T>(json);
  }

  // Метод для обновления конфигурации
  updateConfig(newConfig: Partial<Variables<T>>): void {
    this.config = { ...this.config, ...newConfig };
  }

  // Метод для получения текущей конфигурации
  getConfig(): Variables<T> {
    return { ...this.config };
  }

  get browser(): Variables<T>["browser"] {
    return this.config.browser;
  }
}

// Создаем дефолтный экземпляр конфигурации
const defaultConfig = new Config();
export default defaultConfig;

export { Config, defaultConfig };
export type { BrowserArgs, Variables };
