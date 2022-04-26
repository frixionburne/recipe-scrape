const axios = require('axios').default;
const cheerio = require('cheerio');
const fs = require('fs');

const SITE_URL = "https://fitfoodiefinds.com";
const RECIPE_LIST_URL = `${SITE_URL}/recipes/`;
const RECIPE_DIR_NAME = "fitfoodiefinds.com";


const getMaxRecipeListPageNumber = $ => {
    const paginationContainer = $('.archive-pagination.pagination ul');
    const paginationNext = paginationContainer.find(".pagination-next");
    const lastPageElement = paginationNext.prev();
    const pageNumberRegex = /([0-9]+)/;
    const match = lastPageElement.find('a').text().match(pageNumberRegex);
    return parseInt(match[0], 10);
};

const getRecipeLinks = $ => {
    const recipeArticles = $('.site-container .site-inner .content-sidebar-wrap article');
    const links = [];
    recipeArticles.each((i, element) => {
        links.push($(element).find('a').attr('href'));
    });
    return links;
}

const getPageRangeAndFirstPageLinks = async () => {
    const result = {
        pageRange: [],
        links: []
    };
    try {
        const recipeListBasePageResponse = await axios.get(RECIPE_LIST_URL);
        const $ = cheerio.load(recipeListBasePageResponse.data);
        const maxPage = getMaxRecipeListPageNumber($);
        console.log(`Found max page: ${maxPage}`);
        result.pageRange = [...Array(maxPage).keys()].map(i => i + 1);
        result.links = getRecipeLinks($);
        return result;
    }
    catch (e) {
        console.error("Error getting base recipe list page.");
        console.error(e);
        return null;
    }
}

const getRecipeStyle = $ => {
    const wprmContainer = $('.wprm-recipe-container');
    if (wprmContainer.length > 0) {
        return 'WPRM';
    }
    const tastyContainer = $('.tasty-recipes-entry-content');
    if (tastyContainer.length > 0) {
        return 'TASTY';
    }
    return null;
}

const parseWprmRecipe = $ => {
    const recipe = {
        title: null,
        ingredientGroups: [],
        instructionGroups: []
    }
    recipe.title = $('.wprm-recipe-name').text();
    recipe.ingredientGroups = parseWprmIngredientGroups($);
    recipe.instructionGroups = parseWprmInstructionGroups($);
    return recipe;
}

const parseWprmIngredientGroups = $ => {
    const $ingredientsContainer = $('.wprm-recipe-ingredients-container');
    const ingredientGroups = [];
    const $ingredientGroups = $ingredientsContainer.find('.wprm-recipe-ingredient-group');
    $ingredientGroups.each((i, ingredientGroup) => {
        const title = $(ingredientGroup).find('h4').text();
        const $ingredients = $(ingredientGroup).find('ul li');
        const ingredients = [];
        $ingredients.each((i, element) => {
            ingredients.push($(element).text());
        });
        ingredientGroups.push({
            name: title,
            ingredients: ingredients
        });
    });
    return ingredientGroups;
}

const parseWprmInstructionGroups = $ => {
    const $instructionsContainer = $('.wprm-recipe-instructions-container');
    const instructionGroups = [];
    const $instructionGroups = $instructionsContainer.find('.wprm-recipe-instruction-group');
    $instructionGroups.each((i, instructionGroup) => {
        const title = $(instructionGroup).find('h4').text();
        const $instructions = $(instructionGroup).find('ul li');
        const instructions = [];
        $instructions.each((i, element) => {
            instructions.push($(element).text());
        });
        instructionGroups.push({
            name: title,
            instructions: instructions
        });
    });
    return instructionGroups;
}

const parseTastyRecipe = $ => {
    const recipe = {
        title: null,
        ingredientGroups: [],
        instructionGroups: []
    }
    recipe.title = $('.tasty-recipes-title').text();
    recipe.ingredientGroups = parseTastyIngredientGroups($);
    recipe.instructionGroups = parseTastyInstructionGroups($);
    return recipe;
}

const parseTastyIngredientGroups = $ => {
    const $ingredientsContainer = $('.tasty-recipes-ingredients');
    const ingredientGroups = [];
    let currentGroupTitle = null;
    $ingredientsContainer.children().each((i, ingredientChild) => {
        const tagName = $(ingredientChild).get(0).tagName;
        if (tagName === 'h4') {
            currentGroupTitle = $(ingredientChild).text();
        }
        if (tagName === 'ul') {
            const $items = $(ingredientChild).find('li');
            const ingredients = [];
            $items.each((i, element) => {
                ingredients.push($(element).text());
            });
            ingredientGroups.push({
                name: currentGroupTitle,
                ingredients: ingredients
            });
        }
    });
    return ingredientGroups;
}

const parseTastyInstructionGroups = $ => {
    const $instructionsContainer = $('.tasty-recipes-instructions');
    const instructionGroups = [];
    let currentGroupTitle = null;
    $instructionsContainer.children().each((i, instructionChild) => {
        const tagName = $(instructionChild).get(0).tagName;
        if (tagName === 'h4') {
            currentGroupTitle = $(instructionChild).text();
        }
        if (tagName === 'ol') {
            const $items = $(instructionChild).find('li');
            const instructions = [];
            $items.each((i, element) => {
                instructions.push($(element).text());
            });
            instructionGroups.push({
                name: currentGroupTitle,
                instructions: instructions
            });
        }
    });
    return instructionGroups;
}


const parseRecipe = async url => {
    try {
        console.log(`Fetching Recipe: '${url}'`);
        const recipeResponse = await axios.get(url);
        const $ = cheerio.load(recipeResponse.data);
        const recipeStyle = getRecipeStyle($);
        if (recipeStyle === null) {
            console.error(`Recipe Style: Could not determine for url: ${url}`);
            return null;
        }

        console.log(`Recipe Style: '${recipeStyle}'`);
        let recipe = null;
        switch (recipeStyle) {
            case 'WPRM':
                recipe = parseWprmRecipe($);
                break;
            case 'TASTY':
                recipe = parseTastyRecipe($);
                break;
            default:
                console.error(`Unknown recipe style '${recipeStyle}'`);
        }
        if (recipe === null) {
            console.error(`Failed to parse a recipe for '${url}'`);
            return null;
        } else {
            recipe.url = url;
            recipe.scraped = (new Date()).toISOString();
            return recipe;
        }

    }
    catch (e) {
        console.error(`Error getting recipe for '${url}'`, e);
        return null;
    }
}

const saveRecipe = async (directory, filename, content) => {
    return new Promise((resolve, reject) => {
        const directoryExists = fs.existsSync(directory);
        if (!directoryExists) {
            fs.mkdirSync(directory);
        }
        const fileSave = fs.writeFile(
            `${directory}/${filename}`,
            content,
            err => {
                if (err) {
                    console.error("Error writing file", err);
                    reject(err);
                }
                else {
                    resolve(null);
                }
            }
        );
    });
}

const run = async () => {
    const searchPageResult = await getPageRangeAndFirstPageLinks();
    if (searchPageResult === null) {
        return;
    }

    for (let i = 0; i < searchPageResult.pageRange.length; i++) {
        const page = searchPageResult.pageRange[i];
        console.log(`Fetching recipe list page: ${page}`);
        try {
            const pageResponse = await axios.get(`${RECIPE_LIST_URL}/page/${page}`);
            const $ = cheerio.load(pageResponse.data);
            searchPageResult.links = searchPageResult.links.concat(getRecipeLinks($));
        }
        catch (e) {
            console.error(`Error getting recipe list page '${page}'`);
            console.error(e);
            return;
        }
    }

    for (let i = 0; i < searchPageResult.links.length; i++) {
        const link = searchPageResult.links[i];
        console.log(`Fetching recipe ${link}`);
        const recipe = await parseRecipe(link);
        if (recipe === null) {
            console.error(`Failed to get recipe for '${link}'`);
        } else {
            const recipeDir = `${__dirname}/recipes/${RECIPE_DIR_NAME}`;
            const filename = link
                .replace(SITE_URL, "")
                .replace(/\//g, "")
                + ".json";
            const recipeJsonString = JSON.stringify(recipe, null, 2);
            console.log(`Successfully retrieved recipe for '${link}', saving to ${filename}`);
            try {
                await saveRecipe(recipeDir, filename, recipeJsonString);
                console.log(`Saved recipe from '${link}' to ${recipeDir}/${filename}`);
            }
            catch (e) {
                console.error(`Failed to save recipe from '${link}' to ${recipeDir}/${filename}`, e);
            }
        }
    }
}

const debugSingle = async url => {
    const recipe = await parseRecipe(url);
    if (recipe === null) {
        console.error(`Failed to get recipe for '${url}'`);
    } else {
        const recipeDir = `${__dirname}/recipes/${RECIPE_DIR_NAME}`;
        const filename = url
            .replace(SITE_URL, "")
            .replace(/\//g, "")
            + ".json";
        const recipeJsonString = JSON.stringify(recipe, null, 2);
        console.log(`Successfully retrieved recipe for '${url}', saving to ${filename}`);
        try {
            await saveRecipe(recipeDir, filename, recipeJsonString);
            console.log(`Saved recipe from '${url}' to ${recipeDir}/${filename}`);
        }
        catch (e) {
            console.error(`Failed to save recipe from '${url}' to ${recipeDir}/${filename}`, e);
        }
    }
}

run();
// debugSingle("https://fitfoodiefinds.com/chicken-tinga-tacos/");

