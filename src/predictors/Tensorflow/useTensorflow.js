/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useCallback, useRef } from "react";
// import * as mobilenet from "@tensorflow-models/mobilenet";
import * as tf from "@tensorflow/tfjs";

import useModelReducer, { actions } from "hooks/useModelReducer";
import IMAGENET_CLASSES from "data/imagenetClasses";

const MODEL_URL = "./squeezenet-tfjs/model.json";
// const MODEL_URL =
// 	"https://tfhub.dev/google/imagenet/mobilenet_v2_050_224/classification/2";
const IMAGE_SIZE = 227;

let tfModel;

async function getTopKClasses(logits, topK = 5) {
	const softmax = logits.softmax();
	const values = await softmax.data();
	softmax.dispose();

	const valuesAndIndices = [];
	for (let i = 0; i < values.length; i++) {
		valuesAndIndices.push({ value: values[i], index: i });
	}
	valuesAndIndices.sort((a, b) => {
		return b.value - a.value;
	});
	const topkValues = new Float32Array(topK);
	const topkIndices = new Int32Array(topK);
	for (let i = 0; i < topK; i++) {
		topkValues[i] = valuesAndIndices[i].value;
		topkIndices[i] = valuesAndIndices[i].index;
	}

	const topClassesAndProbs = [];
	for (let i = 0; i < topkIndices.length; i++) {
		topClassesAndProbs.push({
			className: IMAGENET_CLASSES[topkIndices[i]][1],
			probability: topkValues[i]
		});
	}
	return topClassesAndProbs;
}

function infer(img) {
	return tf.tidy(() => {
		if (!(img instanceof tf.Tensor)) {
			img = tf.browser.fromPixels(img);
		}
		// const inputMax = 1;
		// const inputMin = -1;
		// const normalizationConstant = (inputMax - inputMin) / 255.0;

		// Normalize the image from [0, 255] to [inputMin, inputMax].
		const normalized = img.toFloat();
		// .mul(normalizationConstant)
		// .add(inputMin);

		// Resize the image to
		let resized = normalized;
		if (img.shape[0] !== IMAGE_SIZE || img.shape[1] !== IMAGE_SIZE) {
			const alignCorners = true;
			resized = tf.image.resizeBilinear(
				normalized,
				[IMAGE_SIZE, IMAGE_SIZE],
				alignCorners
			);
		}

		// Reshape so we can pass it to predict.
		const batched = resized.reshape([-1, IMAGE_SIZE, IMAGE_SIZE, 3]);

		// let result;

		const result = tfModel.predict(batched);
		// Remove the very first logit (background noise).
		// result = logits1001.slice([0, 1], [-1, 1000]);

		return result;
	});
}

export default function({ imageUrl, backend }) {
	const [state, dispatch] = useModelReducer();
	const currentBackend = useRef();

	const loadModel = async () => {
		tfModel = await tf.loadGraphModel(MODEL_URL, { fromTFHub: false });
		const zeros = tf.zeros([1, IMAGE_SIZE, IMAGE_SIZE, 3]);
		tfModel.predict(zeros).print();
		tf.setBackend(backend);
		currentBackend.current = backend;
		dispatch({ type: actions.MODEL_LOADED });
	};

	const predict = async () => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.src = imageUrl;
		img.width = IMAGE_SIZE;
		img.height = IMAGE_SIZE;
		img.onload = async function() {
			setTimeout(async () => {
				const start = new Date();
				const logits = infer(img);
				const prediction = await getTopKClasses(logits, 5);
				logits.dispose();
				const end = new Date();
				dispatch({
					type: actions.PREDICTION_COMPLETE,
					payload: {
						prediction: prediction.map(item => ({
							...item,
							name: item.className,
							probability: item.probability * 100
						})),
						inferenceTime: end.getTime() - start.getTime()
					}
				});
			}, 2000);
		};
	};

	useEffect(() => {
		if (state.status === actions.INIT) {
			loadModel();
			return () => {};
		}
		if (!state.prediction && state.status === actions.MODEL_LOADED) {
			predict();
			return () => {};
		}
		return () => {};
	}, [state.status]);

	useEffect(() => {
		dispatch({ type: actions.RESET });
	}, [imageUrl, backend]);

	const startPrediction = useCallback(() => {
		if (imageUrl && backend) {
			if (backend === currentBackend.current) {
				dispatch({ type: actions.MODEL_LOADED });
			} else {
				dispatch({ type: actions.INIT });
			}
		}
	}, [imageUrl, backend]);

	return { ...state, startPrediction };
}
