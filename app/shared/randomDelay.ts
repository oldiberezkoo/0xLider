const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const randomDelay = async (min: number, max: number) => {
	const delayTime = Math.floor(Math.random() * (max - min) + min)
	await delay(delayTime)
}

export { delay, randomDelay }
