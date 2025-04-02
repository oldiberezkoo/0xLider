import { promises as fs } from "fs"
import path from "path"

/**
 * Интерфейс результатов.
 */

/**
 * Читает JSON-файл по указанному пути и парсит его в тип T.
 *
 * @param filePath - Путь к файлу, относительно корня процесса (process.cwd())
 * @param defaultValue - Значение по умолчанию, которое возвращается, если файл не найден.
 * @returns Прочитанные и распарсенные данные в типе T.
 * @throws Если файл не найден и не указано значение по умолчанию, либо если возникает ошибка при чтении/парсинге.
 */
export async function readJsonFile<T>(...filePath: string[]): Promise<T> {
	const fullPath = path.join(process.cwd(), ...filePath)
	try {
		const data = await fs.readFile(fullPath, "utf-8")
		try {
			console.log(`✅ | Чтение файла "${fullPath}"`)
      return JSON.parse(data) as T
		} catch (parseError) {
			throw new Error(`❌ | Ошибка парсинга JSON из файла "${fullPath}": ${parseError}`)
		}
	} catch (error: any) {
		if (error.code === "ENOENT") {
			throw new Error(`❌ | Файл не найден: ${fullPath}`)
		}
		throw new Error(`❌ | Ошибка чтения файла "${fullPath}": ${error}`)
	}
}


// export async function readResults(): Promise<Results> {
// 	return await readJsonFile<Results>("links", "results.json")
// }
