type ErrorTypes = "error" | "warning" | "info" | "success" | "debug";

class Logger {
  private static getEmoji(type: ErrorTypes): string {
    switch (type) {
      case "error":
        return "❌";
      case "warning":
        return "⚠️";
      case "info":
        return "ℹ️";
      case "success":
        return "✅";
      default:
        return "🔍";
    }
  }

  static log(type: ErrorTypes, message: string): void {
    console.log(`${this.getEmoji(type)} | ${message}`);
  }
}

export default Logger;

export type { ErrorTypes };
