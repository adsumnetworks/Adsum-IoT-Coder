import { expect } from "chai"
import { detectPython } from "@/platform/pythonDetector"

describe("Python Detection", function () {
  this.timeout(10000)

  it("should detect python3, python, or py -3", async () => {
    const python = await detectPython()
    // Should find at least one python executable on the system
    expect(python).to.not.be.null
    expect(python).to.match(/python|py/)
  })
})
