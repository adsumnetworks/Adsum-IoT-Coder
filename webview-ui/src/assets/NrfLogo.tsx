import React from "react"
import { iconBase64 } from "./iconBase64"

const NrfLogo = (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
	<img alt="IoT AI Debugger Logo" src={iconBase64} {...props} />
)

export default NrfLogo
