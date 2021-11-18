const fs = require('fs');
const path = require('path');
const glob = require('glob');
const postcss = require('postcss');
const less = require('less');
const hash = require('hash.js');
const NpmImportPlugin = require('less-plugin-npm-import');
const stripCssComments = require('strip-css-comments');

let hashCache = '';
let cssCache = '';

function randomColor () {
  return '#' + (0x1000000 + Math.random() * 0xffffff).toString(16).substr(1, 6);
}

/*
  Recursively get the color code assigned to a variable e.g.
  @primary-color: #1890ff;
  @link-color: @primary-color;

  @link-color -> @primary-color ->  #1890ff
  Which means
  @link-color: #1890ff
*/
function getColor(varName, mappings) {
    const color = mappings[varName];
    if (color in mappings) {
        return getColor(color, mappings);
    } else {
        return color;
    }
}

function combineLess(filePath, nodeModulesPath) {
  if (!filePath) {
    return ''
  }
  const fileContent = fs.readFileSync(filePath).toString();
  const directory = path.dirname(filePath);
  return fileContent
    .split('\n')
    .map((line) => {
      if (line.startsWith('@import')) {
        let importPath = line.match(/@import\ ["'](.*)["'];/)[1];
        if (!importPath.endsWith('.less')) {
          importPath += '.less';
        }
        let newPath = path.join(directory, importPath);
        if (importPath.startsWith('~')) {
          importPath = importPath.replace('~', '');
          newPath = path.join(nodeModulesPath, `./${importPath}`);
        }
        return combineLess(newPath, nodeModulesPath);
      }
      return line;
    })
    .join('\n');
}

function generateColorMap(content, customColorRegexArray = []) {
  return content
    .split('\n')
    .filter((line) => line.startsWith('@') && line.indexOf(':') > -1)
    .reduce((prev, next) => {
      try {
        const matches = next.match(/(?=\S*['-])([@a-zA-Z0-9'-]+).*:[ ]{1,}(.*);/);
        if (!matches) {
          return prev;
        }
        let [, varName, color] = matches;
        if (color && color.startsWith('@')) {
          color = getColor(color, prev);
          if (!isValidColor(color, customColorRegexArray)) return prev;
          prev[varName] = color;
        } else if (isValidColor(color, customColorRegexArray)) {
          prev[varName] = color;
        }
        return prev;
      } catch (e) {
        console.log('e', e);
        return prev;
      }
    }, {});
}

function getLessVars(filtPath) {
  const sheet = fs.readFileSync(filtPath).toString();
  const lessVars = {};
  const matches = sheet.match(/@(.*:[^;]*)/g) || [];
  matches.forEach((variable) => {
    const definition = variable.split(/:\s*/);
    const varName = definition[0].replace(/['"]+/g, '').trim();
    lessVars[varName] = definition.splice(1).join(':');
  });
  return lessVars;
}

function getMatches(string, regex) {
  const matches = {};
  let match;
  while ((match = regex.exec(string))) {
    if (match[2].startsWith('rgba') || match[2].startsWith('#')) {
      matches[`@${match[1]}`] = match[2];
    }
  }
  return matches;
}

function render(text, paths) {
  return less.render(text, {
    paths: paths,
    javascriptEnabled: true,
    plugins: [new NpmImportPlugin({ prefix: '~' })],
  });
}

/*
  This funtion reads a less file and create an object with keys as variable names
  and values as variables respective values. e.g.
  //variabables.less
    @primary-color : #1890ff;
    @heading-color : #fa8c16;
    @text-color : #cccccc;

    to

    {
      '@primary-color' : '#1890ff',
      '@heading-color' : '#fa8c16',
      '@text-color' : '#cccccc'
    }

*/
function getLessVars(filtPath) {
    const sheet = fs.readFileSync(filtPath).toString();
    const lessVars = {};
    const matches = sheet.match(/@(.*:[^;]*)/g) || [];

    matches.forEach((variable) => {
        const definition = variable.split(/:\s*/);
        const varName = definition[0].replace(/['"]+/g, "").trim();
        lessVars[varName] = definition.splice(1).join(":");
    });
    return lessVars;
}

/*
  This function take primary color palette name and returns @primary-color dependent value
  .e.g
  Input: @primary-1
  Output: color(~`colorPalette("@{primary-color}", ' 1 ')`)
*/
function getShade(varName) {
    let [, className, number] = varName.match(/(.*)-(\d)/);
    if (/primary-\d/.test(varName)) className = "@primary-color";
    return (
        'color(~`colorPalette("@{' +
        className.replace("@", "") +
        '}", ' +
        number +
        ")`)"
    );
}

/*
  This function takes color string as input and return true if string is a valid color otherwise returns false.
  e.g.
  isValidColor('#ffffff'); //true
  isValidColor('#fff'); //true
  isValidColor('rgba(0, 0, 0, 0.5)'); //true
  isValidColor('20px'); //false
*/
function isValidColor(color, customColorRegexArray = []) {
    if (color && color.includes("rgb")) return true;
    if (!color || color.match(/px/g)) return false;
    if (color.match(/colorPalette|fade/g)) return true;
    if (color.charAt(0) === "#") {
        color = color.substring(1);
        return (
            [3, 4, 6, 8].indexOf(color.length) > -1 && !isNaN(parseInt(color, 16))
        );
    }
    // eslint-disable-next-line
    const isColor = /^(rgb|hsl|hsv)a?\((\d+%?(deg|rad|grad|turn)?[,\s]+){2,3}[\s\/]*[\d\.]+%?\)$/i.test(
        color
    );
    if (isColor) return true;
    if (customColorRegexArray.length > 0) {
        return customColorRegexArray.reduce((prev, regex) => {
            return prev || regex.test(color);
        }, false);
    }
    return false;
}

async function compileAllLessFilesToCss(
    stylesDir,
    antdStylesDir,
    varMap = {},
    varPath
) {
    /*
      Get all less files path in styles directory
      and then compile all to css and join
    */
    const stylesDirs = [].concat(stylesDir);
    let styles = [];
    stylesDirs.forEach((s) => {
        styles = styles.concat(glob.sync(path.join(s, "./**/*.less")));
    });
    const csss = await Promise.all(
        styles.map((filePath) => {
            let fileContent = fs.readFileSync(filePath).toString();
            // Removed imports to avoid duplicate styles due to reading file separately as well as part of parent file (which is importing)
            // if (avoidDuplicates) fileContent = fileContent.replace(/@import\ ["'](.*)["'];/g, '\n');
            const r = /@import ["'](.*)["'];/g;
            const directory = path.dirname(filePath);
            fileContent = fileContent.replace(r, function (
                match,
                importPath,
                index,
                content
            ) {
                if (!importPath.endsWith(".less")) {
                    importPath += ".less";
                }
                const newPath = path.join(directory, importPath);
                // If imported path/file already exists in styles paths then replace import statement with empty line
                if (styles.indexOf(newPath) === -1) {
                    return match;
                } else {
                    return "";
                }
            });
            Object.keys(varMap).forEach((varName) => {
                fileContent = fileContent.replace(
                    new RegExp(`(:.*)(${varName})`, "g"),
                    (match, group, a) => {
                        return match.replace(varName, varMap[varName]);
                    }
                );
            });
            fileContent = `@import "${varPath}";\n${fileContent}`;
            // fileContent = `@import "~antd/lib/style/themes/default.less";\n${fileContent}`;
            return less
                .render(fileContent, {
                    paths: [antdStylesDir].concat(stylesDir),
                    filename: path.resolve(filePath),
                    javascriptEnabled: true,
                    plugins: [new NpmImportPlugin({ prefix: "~" })],
                })
                .then((res) => {
                    return res;
                })
                .catch((e) => {
                    console.error(`Error occurred compiling file ${filePath}`);
                    console.error("Error", e);
                    return "\n";
                });
        })
    );
    const hashes = {};

    return csss
        .map((c) => {
            const css = stripCssComments(c.css || "", { preserve: false });
            const hashCode = hash.sha256().update(css).digest("hex");
            if (hashCode in hashes) {
                return "";
            } else {
                hashes[hashCode] = hashCode;
                return css;
            }
        })
        .join("\n");
}

const reducePlugin = postcss.plugin('reducePlugin', () => {
  const cleanRule = (rule) => {
    if (rule.selector.startsWith('.main-color .palatte-')) {
      rule.remove();
      return;
    }

    let removeRule = true;
    rule.walkDecls((decl) => {
      if (String(decl.value).match(/url\(.*\)/g)) {
        decl.remove();
      }
      const matched = false;
      /*
      this block causing https://github.com/ant-design/ant-design/issues/24777
      if (decl.prop !== 'background' && decl.prop.includes('background') && !decl.prop.match(/^background-(.*)color$/ig)) {
        decl.remove();
        matched = true;
      }
      if (decl.prop !== 'border' && decl.prop.includes('border') && !decl.prop.match(/^border-(.*)color$/ig)) {
        decl.remove();
        matched = true;
      }
      if (['transparent', 'inherit', 'none', '0'].includes(decl.value)) {
        decl.remove();
        matched = true;
      }
      */
      if (
        !decl.prop.includes('color') &&
        !decl.prop.includes('background') &&
        !decl.prop.includes('border') &&
        !decl.prop.includes('box-shadow') &&
        !Number.isNaN(decl.value)
      ) {
        // if (!matched) decl.remove();
        decl.remove();
      } else {
        removeRule = matched ? removeRule : false;
      }
    });
    if (removeRule) {
      rule.remove();
    }
  };
  return (css) => {
    css.walkAtRules((atRule) => {
      atRule.remove();
    });

    css.walkRules(cleanRule);

    css.walkComments((c) => c.remove());
  };
});

function minifyCss (css) {
  css = css.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').replace(/^\s*$(?:\r\n?|\n)/gm, '');
  css = css.replace(/\{(\r\n?|\n)\s+/g, '{');
  css = css.replace(/;(\r\n?|\n)\}/g, ';}');
  css = css.replace(/;(\r\n?|\n)\s+/g, ';');
  css = css.replace(/,(\r\n?|\n)[.]/g, ', .');
  // Further compress CSS to one line.
  css = css.replace(/;(\r\n?|\n|\s\S*)/g, ';');
  css = css.replace(/;(\r\n?|\n)\@/g, ';@');
  css = css.replace(/;(\r\n?|\n)\./g, ';.');
  css = css.replace(/}(\r\n?|\n|\s\S*)/g, '}');
  css = css.replace(/,(\r\n?|\n)/g, ',');
  css = css.replace(/,(\s+)/gm, ',');
  css = css.replace(/(\s+)\{/g, '{');
  css = css.replace(/:(\s+)/g, ':');
  return css;
}

async function compileAllLessFilesToCss(stylesDir, vantStylesDir, varMap = {}, varPath) {
  const styles = glob.sync(path.join(stylesDir, './**/*.less'));
  const csss = await Promise.all(
    styles.map((filePath) => {
      let fileContent = fs.readFileSync(filePath).toString();
      // Removed imports to avoid duplicate styles due to reading file separately as well as part of parent file (which is importing)
      // if (avoidDuplicates) fileContent = fileContent.replace(/@import\ ["'](.*)["'];/g, '\n');
      const r = /@import ["'](.*)["'];/g;
      const directory = path.dirname(filePath);
      fileContent = fileContent.replace(r, function (match, importPath, index, content) {
        if (!importPath.endsWith('.less')) {
          importPath += '.less';
        }
        const newPath = path.join(directory, importPath);
        // If imported path/file already exists in styles paths then replace import statement with empty line
        if (styles.indexOf(newPath) === -1) {
          return match;
        } else {
          return '';
        }
      });
      Object.keys(varMap).forEach((varName) => {
        fileContent = fileContent.replace(
          new RegExp(`(:.*)(${varName})`, 'g'),
          (match, group, a) => {
            return match.replace(varName, varMap[varName]);
          }
        );
      });
      fileContent = `@import "${varPath}";\n${fileContent}`;
      // fileContent = `@import "~antd/lib/style/themes/default.less";\n${fileContent}`;
      return less
        .render(fileContent, {
          paths: [stylesDir, vantStylesDir],
          filename: path.resolve(filePath),
          javascriptEnabled: true,
          plugins: [new NpmImportPlugin({ prefix: '~' })],
        })
        .then((res) => {
          return res;
        })
        .catch((e) => {
          console.error(`Error occurred compiling file ${filePath}`);
          console.error('Error', e);
          return '\n';
        });
    })
  );
  const hashes = {};

  return csss
    .map((c) => {
      const css = stripCssComments(c.css || '', { preserve: false });
      const hashCode = hash.sha256().update(css).digest('hex');
      if (hashCode in hashes) {
        return '';
      } else {
        hashes[hashCode] = hashCode;
        return css;
      }
    })
    .join('\n');
}

async function generateTheme({
  vantDir,
  vantStylesDir,
  stylesDir,
  themeVarFile,
  varFile,
  outputFilePath,
  cssModules = false,
  themeVariables = [],
  customColorRegexArray = [],
}) {
  try {
    let vantPath;
    if (vantStylesDir) {
      vantPath = vantStylesDir;
    } else {
      vantPath = path.join(vantDir, 'lib');
    }
    const nodeModulesPath = path.join(
      vantDir.slice(0, vantDir.indexOf('node_modules')),
      './node_modules'
    );
    const vantStyleFile = path.join(vantDir, './lib/index.less');
    const styles = glob.sync(path.join(stylesDir, './**/*.less'));
    varFile = varFile || path.join(vantPath, './style/var.less');
    let content = '';
    styles.forEach((filePath) => {
      content += fs.readFileSync(filePath).toString();
    });
    const hashCode = hash.sha256().update(content).digest('hex');
    if (hashCode === hashCache) {
      return cssCache;
    }
    hashCache = hashCode;
    let themeCompiledVars = {};
    let themeVars = themeVariables;
    const lessPaths = [path.join(vantPath, './style'), stylesDir];
    const randomColors = {};
    const randomColorsVars = {};
    const varFileContent = combineLess(varFile, nodeModulesPath);
    customColorRegexArray = [
      ...customColorRegexArray,
      ...[
        'color',
        'lighten',
        'darken',
        'saturate',
        'desaturate',
        'fadein',
        'fadeout',
        'fade',
        'spin',
        'mix',
        'hsv',
        'tint',
        'shade',
        'greyscale',
        'multiply',
        'contrast',
        'screen',
        'overlay',
      ].map((name) => new RegExp(`${name}\(.*\)`)),
    ];
    const mappings = Object.assign(
      generateColorMap(varFileContent, customColorRegexArray),
      getLessVars(varFile)
    );
    let css = '';
    themeVars = themeVars.filter((name) => name in mappings && !name.match(/(.*)-(\d)/));
    themeVars.forEach((varName) => {
      let color = randomColor();
      while (randomColorsVars[color]) {
        color = randomColor();
      }
      randomColors[varName] = color;
      randomColorsVars[color] = varName;
      css = `.${varName.replace('@', '')} { color: ${color}; }\n ${css}`;
    });

    let results = await render(css, lessPaths);
    css = results.css;
    css = css.replace(/(\/.*\/)/g, '');
    const regex = /.(?=\S*['-])([.a-zA-Z0-9'-]+)\ {\n {2}color: (.*);/g;
    themeCompiledVars = getMatches(css, regex);

    const userCustomCss = await compileAllLessFilesToCss(
      stylesDir,
      vantStylesDir,
      themeCompiledVars,
      varFile
    );
    let vantLessContent = fs.readFileSync(vantStyleFile).toString();
    let varsCombined = '';
    themeVars.forEach((varName) => {
      let color;
      if (/(.*)-(\d)/.test(varName)) {
        color = getShade(varName);
        return;
      } else {
        color = themeCompiledVars[varName];
      }
      varsCombined = `${varsCombined}\n${varName}: ${color};`;
    });
    vantLessContent = `${vantLessContent}\n${varsCombined}`;
    const { css: vantCss } = await render(vantLessContent, [vantPath, vantStylesDir]);
    const allCss = `${vantCss}\n${userCustomCss}`;
    results = await postcss([reducePlugin]).process(allCss, {
      parser: less.parser,
      from: vantStyleFile,
    });
    css = results.css;
    Object.keys(themeCompiledVars).forEach((varName) => {
      let color;
      if (/(.*)-(\d)/.test(varName)) {
        color = themeCompiledVars[varName];
        varName = getShade(varName);
      } else {
        color = themeCompiledVars[varName];
      }
      color = color.replace('(', '\\(').replace(')', '\\)');
      // css = css.replace(new RegExp(`${color}` + ' *;', 'g'), `${varName};`);
      css = css.replace(new RegExp(color, 'g'), `${varName}`);
    });
    css = css.replace(/@[\w-_]+:\s*.*;[\/.]*/gm, '');

    // css = css.replace(/\\9/g, '');
    css = `${css.trim()}\n${combineLess(
      themeVarFile,
      nodeModulesPath
    )}`;

    themeVars.reverse().forEach((varName) => {
      css = css.replace(new RegExp(`${varName}( *):(.*);`, 'g'), '');
      css = `${varName}: ${mappings[varName]};\n${css}\n`;
    });

    css = minifyCss(css);

    if (outputFilePath) {
      fs.writeFileSync(outputFilePath, css);
      console.log(`🌈 Theme generated successfully. OutputFile: ${outputFilePath}`);
    } else {
      console.log('Theme generated successfully');
    }
    cssCache = css;
    return cssCache;
  } catch (error) {
    console.log('error:', error);
    return '';
  }
}

module.exports = {
  generateTheme,
};
