// --- Configuration & Generalized Regex ---

// Generalized regex for price (supports SEK, KR, EUR, USD, GBP, including commas/dots as decimal separators)
const PRICE_REGEX = /(\d+[.,]\d+|\d+)\s*(kr|sek|eur|euro|\$|£|usd|gbp)/i;

// Generalized regex for weight/volume (supports g, kg, l, ml, including commas/dots)
const WEIGHT_REGEX = /(\d+[.,]\d+|\d+)\s*(g|kg|l|ml)/i;

// Data attribute to mark processed elements
const PROCESSED_ATTR = 'data-unit-price-processed';

/**
 * Parses a numeric string, handling European decimal separator (comma) and ensuring it's a valid number.
 * @param {string} value - The matched numeric string.
 * @returns {number} The cleaned numeric value.
 */
function cleanNumber(value) {
	// Replace comma with dot for consistent parsing
	return parseFloat(value.replace(",", "."));
}

/**
 * Calculates the price per unit (always based on kg or L) and formats the output string.
 * @param {number} priceKr - The price in the site's currency.
 * @param {number} weightValue - The numeric value of the weight/volume.
 * @param {string} unit - The unit ('g', 'kg', 'ml', or 'l').
 * @returns {string} The formatted price/kg or price/L string.
 */
function calculateAndFormatUnit(priceKr, weightValue, unit) {
	const lowerUnit = unit.toLowerCase();
	let pricePerBaseUnit; // Base unit is kg or L
	let displayUnit = "kg";

	if (lowerUnit === "g" || lowerUnit === "ml") {
		// If unit is gram or milliliter, convert to per 1000 base units (kg or L)
		pricePerBaseUnit = (priceKr / weightValue) * 1000;
		displayUnit = lowerUnit === "g" ? "kg" : "L";
	} else {
		// 'kg' or 'l'
		pricePerBaseUnit = priceKr / weightValue;
		displayUnit = lowerUnit === "kg" ? "kg" : "L";
	}

	// Format the result to two decimal places
	return `~${pricePerBaseUnit.toFixed(2)} / ${displayUnit}`;
}

/**
 * Iterates through the DOM to find price elements, then finds a matching weight element and their common ancestor,
 * which is treated as the product block.
 */
function findAndProcessPrices() {
	// Tags to ignore when looking for prices
	const ignoredTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'HTML', 'HEAD', 'META', 'LINK'];
	
	// 1. Find all elements that likely contain a price
	const allElements = Array.from(document.querySelectorAll("*"));
	const potentialPriceElements = allElements.filter((el) => {
		// Skip ignored tags
		if (ignoredTags.includes(el.tagName)) {
			return false;
		}
		// Skip elements that are already our injected unit prices
		if (el.classList?.contains('unit-price-kr-kg-appended')) {
			return false;
		}
		// Skip body and html
		if (el === document.body || el === document.documentElement) {
			return false;
		}
		// Must have matching price text
		if (!el.textContent.match(PRICE_REGEX)) {
			return false;
		}
		// Prefer leaf elements - skip if a child element also has the price
		// (to avoid processing both parent and child)
		const hasChildWithPrice = Array.from(el.children).some(child => 
			child.textContent.match(PRICE_REGEX)
		);
		return !hasChildWithPrice;
	});
	
	console.log(`Found ${potentialPriceElements.length} potential price elements`);

	// 2. Process each potential price element
	potentialPriceElements.forEach((elPrice) => {
		// Skip if this specific price element has already been processed
		if (elPrice.hasAttribute(PROCESSED_ATTR)) {
			return;
		}

		// Walk up from the price element to find a suitable product container
		let currentContainer = elPrice;
		let bestMatchData = null;
		let weightElement = null;

		// Limit the search depth (e.g., 8 levels up) to avoid hitting <body> too quickly
		for (let i = 0; i < 8 && currentContainer; i++) {
			// CRITICAL FIX: Check early if this container element has been processed.
			if (currentContainer.hasAttribute(PROCESSED_ATTR)) {
				return; // Stop processing this elPrice if its container is already done
			}

			// Look for a weight/volume match inside the current container
			const weightMatches = Array.from(
				currentContainer.querySelectorAll("*"),
			).filter((el) => el.textContent.match(WEIGHT_REGEX));

			if (weightMatches.length > 0) {
				// If multiple weights, assume the closest one in the DOM tree is the correct one.
				// For simplicity here, we'll just pick the first match.
				weightElement = weightMatches[0];

				// Try to validate the extracted data
				const priceMatch = elPrice.textContent.match(PRICE_REGEX);
				const weightMatch = weightElement.textContent.match(WEIGHT_REGEX);

				if (priceMatch && weightMatch) {
					const priceKr = cleanNumber(priceMatch[1]);
					const weightValue = cleanNumber(weightMatch[1]);
					const weightUnit = weightMatch[2];

					if (
						!Number.isNaN(priceKr) &&
						!Number.isNaN(weightValue) &&
						priceKr > 0 &&
						weightValue > 0
					) {
						bestMatchData = {
							container: currentContainer,
							elPrice: elPrice, // Pass the price element for in-place injection
							priceKr,
							weightValue,
							weightUnit,
						};
						break; // Found a valid container and data, stop walking up
					}
				}
			}
			currentContainer = currentContainer.parentElement;
		}

		if (bestMatchData) {
			// Mark container as processed before calling processProductBlock
			// to prevent concurrent processing by other elPrice elements in the same container.
			if (!bestMatchData.container.hasAttribute(PROCESSED_ATTR)) {
				bestMatchData.container.setAttribute(PROCESSED_ATTR, 'true');
				processProductBlock(bestMatchData);
			}
		}
	});
}

/**
 * Processes the validated product data and injects the result by modifying the price element's display.
 * @param {object} data - Object containing container, elPrice, priceKr, weightValue, weightUnit.
 */
function processProductBlock(data) {
	const { elPrice, priceKr, weightValue, weightUnit } = data;

	// Mark the price element as processed immediately
	elPrice.setAttribute(PROCESSED_ATTR, 'true');

	// Safety check: don't process elements that are too high in the DOM tree
	if (!elPrice.parentNode || elPrice.parentNode === document || elPrice === document.documentElement || elPrice === document.body) {
		console.warn('Skipping price element that is too high in DOM tree');
		return;
	}

	// Check if already has a unit price appended next to it
	const nextSibling = elPrice.nextElementSibling;
	if (nextSibling?.classList.contains('unit-price-kr-kg-appended')) {
		return;
	}

	// 1. Calculate the unit price (e.g., ~198.00 / kg)
	const unitPriceText = calculateAndFormatUnit(
		priceKr,
		weightValue,
		weightUnit,
	);

	// 2. Create a new span element for the unit price
	const unitPriceSpan = document.createElement('span');
	unitPriceSpan.className = 'unit-price-kr-kg-appended';
	unitPriceSpan.style.fontWeight = '500';
	unitPriceSpan.style.color = '#4b5563';
	unitPriceSpan.style.fontSize = '0.85em';
	unitPriceSpan.style.marginLeft = '4px';
	unitPriceSpan.style.display = 'inline-block';
	unitPriceSpan.textContent = `- ${unitPriceText}`;

	// 3. Insert the unit price right after the price element
	try {
		elPrice.parentNode.insertBefore(unitPriceSpan, elPrice.nextSibling);
		console.log(`Injected ${unitPriceText} for price ${priceKr}`);
	} catch (error) {
		console.warn('Failed to inject unit price:', error.message);
	}
}

/**
 * Traverses the DOM to find all product blocks and processes them.
 */
function initializeProcessor() {
	findAndProcessPrices();
}

// Run the processor when the DOM is fully loaded
// Use a MutationObserver to catch dynamically loaded content
let processingTimeout = null;
let isProcessing = false;

function startProcessing() {
	// Debounce to avoid processing too frequently
	clearTimeout(processingTimeout);
	processingTimeout = setTimeout(() => {
		if (!isProcessing) {
			isProcessing = true;
			findAndProcessPrices();
			isProcessing = false;
		}
	}, 200); // Wait 200ms after last mutation before processing
}

const observer = new MutationObserver((mutations) => {
	// Check if mutations include our own injected elements, skip if so
	const hasSelfMutation = mutations.some(mutation => {
		return Array.from(mutation.addedNodes).some(node => {
			if (node.nodeType === 1) {
				return node.classList?.contains('unit-price-kr-kg-appended') ||
					   node.querySelector?.('.unit-price-kr-kg-appended');
			}
			return false;
		});
	});
	
	if (!hasSelfMutation) {
		startProcessing();
	}
});

// Initial run
initializeProcessor();

// Start observing changes to the document body for dynamic content loading
observer.observe(document.body, {
	childList: true, // Watch for new elements added
	subtree: true, // Watch all descendants
	characterData: false,
});
