import React from "react"
import { iconBase64 } from "./iconBase64"

const NrfLogo = (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
	<img alt="Adsum IoT Coder Logo" src={iconBase64} {...props} />
)

export default NrfLogo
