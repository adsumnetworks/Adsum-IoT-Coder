// A HostProvider with nothing in it but the two paths a resolver needs.
//
// `resolveToolAsync` and the knowledge resolver read the extension root through
// `HostProvider.get().extensionFsPath`. Outside a host there is no instance, and every read falls through
// to null — silently, by design, because activation must not throw. For a TEST that is the worst possible
// outcome: the bundled floor becomes unreachable and the run goes green having resolved nothing.
//
// So a HIL script that drives the production resolver stands one of these up first. Every creator throws
// if touched: this exists to answer "where is the extension", and anything that asks it for a webview or a
// terminal is being tested in the wrong harness and should say so loudly rather than get a stub.
import * as os from "node:os"
import * as path from "node:path"
import { HostProvider } from "../src/hosts/host-provider"

const refuse = (what: string) => () => {
	throw new Error(`test HostProvider: ${what} was requested — this harness only answers extensionFsPath/globalStorageFsPath`)
}

export function setupHostProviderForTests(extensionRoot: string, storageDir?: string): void {
	try {
		HostProvider.get()
		return // already up (a second script in the same process)
	} catch {
		/* not initialised — that is the normal path here */
	}
	HostProvider.initialize(
		refuse("a webview provider") as never,
		refuse("a diff view provider") as never,
		refuse("a comment review controller") as never,
		refuse("a terminal manager") as never,
		refuse("the host bridge") as never,
		(msg: string) => console.log(`[host] ${msg}`),
		async () => {
			throw new Error("test HostProvider: no callback URL")
		},
		async (name: string) => name,
		extensionRoot,
		storageDir ?? path.join(os.tmpdir(), "adsum-hil-storage"),
	)
}
