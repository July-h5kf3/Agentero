"use client";

import type { TImageElement } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";

export function ImageElement(props: PlateElementProps<TImageElement>) {
	const url = props.element.url;
	const alt = (props.element as { alt?: string }).alt ?? "";

	return (
		<PlateElement {...props} className="py-2">
			<figure className="m-0" contentEditable={false}>
				{url ? (
					<img
						src={url}
						alt={alt}
						className="max-w-full rounded-sm"
						loading="lazy"
					/>
				) : null}
			</figure>
			{props.children}
		</PlateElement>
	);
}
