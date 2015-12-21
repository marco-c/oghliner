/**
 * Copyright 2015 Mozilla
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var gulp = require('gulp');
var conflict = require('gulp-conflict');
var template = require('gulp-template');
var install = require('gulp-install');
var rename = require('gulp-rename');
var promptly = require('promisified-promptly');
var through2 = require('through2');
var chalk = require('chalk');
var changeCase = require('change-case');
var cli = require('cli');
var gitRemoteUrl = require('git-remote-url');
var path = require('path');

function templateConfigPrompt(defaultConfig) {
  process.stdout.write('Your app\'s configuration is:\n\n');
  process.stdout.write(templateConfigToString(defaultConfig) + '\n');

  return promptly.confirm('Would you like to change its configuration (y/N)?', { default: false })
  .then(function(fillInConfig) {
    if (!fillInConfig) {
      return defaultConfig;
    }

    var config = {};

    function prompt(message, prop) {
      return promptly.prompt(message, { default: defaultConfig[prop] }).then(function(answer) {
        config[prop] = answer;
      });
    }

    process.stdout.write('\n\n');

    return prompt(chalk.bold('Name:'), 'name')
    .then(prompt.bind(null, chalk.bold('Repository:'), 'repository'))
    .then(prompt.bind(null, chalk.bold('Description:'), 'description'))
    .then(prompt.bind(null, chalk.bold('License:'), 'license'))
    .then(function() {
      return config;
    });
  });
}

function templateConfigOption(defaultConfig, config) {
  for (var key in config) {
    if (typeof defaultConfig[key] === 'undefined') {
      throw new Error('Unrecognized template option: ' + key);
    }
    defaultConfig[key] = config[key];
  }
  return defaultConfig;
}

function templateConfigToString(config) {
  var out = [];
  for (var key in config) {
    out.push(chalk.bold(changeCase.upperCaseFirst(key)) + ': ' + config[key]);
  }
  return out.join('\n') + '\n';
}

function getDefaultTemplateConfig(dir) {
  var config = {
    name: 'oghliner-template-app',
    repository: 'https://oghliner-template-app.git',
    description: 'A template app bootstrapped with oghliner.',
    license: 'Apache-2.0',
  };

  return gitRemoteUrl(dir, 'origin')
  .then(function(url) {
    config.repository = url;
    // Try to fill in the project named based on the repo url.
    if (url.substr(-4, 4) === '.git') {
      config.name = url.substring(url.lastIndexOf('/') + 1, url.length - 4);
    }
  })
  .catch(function() {})
  .then(function() { return config; });
}

function sink() {
  return through2.obj(function (file, enc, callback) {
    callback();
  });
}

module.exports = function(config) {
  config = config || {};
  var rootDir = config.rootDir ? config.rootDir : '.';

  process.stdout.write(
    'Bootstrapping ' + (rootDir === '.' ? 'current directory' : chalk.bold(path.normalize(rootDir + '/'))) +
    ' as Oghliner app…\n\n'
  );

  return getDefaultTemplateConfig(rootDir)
    .then(function(defaultConfig) {
      if (config.template) {
        return templateConfigOption(defaultConfig, config.template);
      }
      return templateConfigPrompt(defaultConfig);
    })
    .then(function(templateConfig) {
      process.stdout.write('\nCreating files…\n');

      templateConfig.oghlinerVersion = require(__dirname + '/../package.json').version;

      return new Promise(function(resolve, reject) {
        var contents = __dirname + '/../templates/**';
        var workerTemplate = __dirname + '/../templates/app/offline-worker.js';
        var stream = gulp.src([contents, '!' + workerTemplate])
          .pipe(rename(function (path) {
            // NPM can't include a files starting with '.' so we have to rename them.
            if (['gitignore', 'nojekyll'].indexOf(path.basename) !== -1) {
              path.basename = '.' + path.basename;
            }
          }))
          .pipe(template(templateConfig))
          .pipe(conflict(rootDir, {
            logger: function(message, fileName, extraText) {
              process.stdout.write(chalk.green.bold('✓ ') + chalk.stripColor(fileName) + '\n');
            },
          }))
          .pipe(gulp.dest(rootDir))
          .on('end', function() {
            process.stdout.write('\n' + chalk.green.bold('✓ ') + 'Creating files… done!\n');
            cli.spinner('  Installing npm dependencies…');
          })
          .pipe(install({
            log: function() {
              cli.spinner(chalk.red.bold('✗ ') + 'Installing npm dependencies… error!\n', true);
              process.stdout.write(Array.prototype.slice.call(arguments).join('') + '\n');
            },
            npmStdio: ['ignore', 'ignore', 'ignore'],
          }))
          .on('end', function() {
            cli.spinner(chalk.green.bold('✓ ') + 'Installing npm dependencies… done!\n', true);
          })
          .pipe(sink()); // Sink is required to trigger the finish event with install.

        stream.on('finish', function() {
          process.stdout.write(
            'Your app has been bootstrapped! Just commit the changes and push the commit\n' +
            'to the origin/master branch:\n\n' +
            chalk.bold('git add --all && git commit -m"initial version of Oghliner app"') + '\n' +
            chalk.bold('git push origin master') + '\n\n' +
            'Then you can build, offline, and deploy the app using ' + chalk.bold.italic('gulp') + ' commands.\n\n' +
            chalk.blue.bold('ℹ For more information about building, offlining and deployment, see:\n' +
            '    https://mozilla.github.io/oghliner/') + '\n'
          );

          resolve();
        });

        stream.on('error', reject);
      });
    });
};
