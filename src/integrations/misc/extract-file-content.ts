import { Anthropic } from "@anthropic-ai/sdk"
import fs from "fs/promises"
import * as path from "path"
import { extractImageContent } from "./extract-images"
import { callTextExtractionFunctions } from "./extract-text"

export type FileContentResult = {
	text: string
	imageBlock?: Anthropic.ImageBlockParam
}

/**
 * Extract content from a file, handling both text and images
 * Extra logic for handling images based on whether the model supports images
 */
export async function extractFileContent(absolutePath: string, modelSupportsImages: boolean): Promise<FileContentResult> {
	const fileExtension = path.extname(absolutePath).toLowerCase()
	const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"]
	const isImage = imageExtensions.includes(fileExtension)

	if (isImage) {
		// Check if file exists first
		try {
			await fs.access(absolutePath)
		} catch (_error) {
			throw new Error(`File not found: ${absolutePath}`)
		}
		if (!modelSupportsImages) {
			throw new Error(`Current model does not support image input`)
		}
		const imageResult = await extractImageContent(absolutePath)
		if (imageResult.success) {
			return {
				text: "Successfully read image",
				imageBlock: imageResult.imageBlock,
			}
		}
		throw new Error(imageResult.error)
	}

	// Text files: bounded retry around access + extraction. Transient FS-access failures were observed under
	// the VS Code extensions dir on Windows (a read that "went missing" succeeded on immediate retry, per a
	// real CRA run), so a single blip no longer surfaces as a hard failure that wastes an entire turn. A
	// genuinely-absent file still errors after the retries, preserving the original "File not found" shape.
	let lastError: unknown
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await fs.access(absolutePath)
			return { text: await callTextExtractionFunctions(absolutePath) }
		} catch (error) {
			lastError = error
			if (attempt < 3) {
				await new Promise((resolve) => setTimeout(resolve, 120 * attempt))
			}
		}
	}
	const errorMessage = lastError instanceof Error ? lastError.message : "Unknown error"
	throw new Error(
		/ENOENT|not found|no such file/i.test(errorMessage)
			? `File not found: ${absolutePath}`
			: `Error reading file: ${errorMessage}`,
	)
}
