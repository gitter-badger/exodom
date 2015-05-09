#!/usr/bin/env node

settings = {
    source: {
        url: 'taichung.exosite.com',
        widgetId: 1846278371,
        themeId: '',
        username: 'calvinzheng@exosite.com',
        password: 'Swqaswqa1'
    },
    target: {
        url: 'basco-dev.exosite.com',
        themeId: '',
        widget: '',
        username: 'calvinzheng@exosite.com',
        password: 'Swqaswqa1'
    }
};

// 3rd party
var Q = require('q'),
    debug = require('debug')('main'),
    program = require('commander'),
    request = require('request'),
    fs = require('fs-extra'),
    console = require('better-console');

var os = require('os'),
    path = require('path');

var uploader = require('./uploader.js');

Q.longStackSupport = true;

// constants
var COOKIE_PATH = os.tmpdir() + path.sep + '.wiget-uploader-cookie';
console.log('path.sep ' , path.sep);

debug('cookie: ' + COOKIE_PATH);

program
    .version('0.0.1')
    .command('setup [type] [from_domain] [to_domain]')
    .action(function(cmd, fromDomain, toDomain, options) {
        program.cmd = cmd;
        program.opt = options;
        if (cmd === 'sync') {
            if (!fromDomain || !toDomain) {
                console.error('Miss from_domain or to_domain, please see help')
            } else {
                program.fromDomain = fromDomain;
                program.toDomain = toDomain;
            }
        } else if (cmd === 'save') {
            if (!fromDomain) {
                console.error('Miss from_domain, please see help')
            } else {
                program.fromDomain = fromDomain;
                program.current = 'source';
            }
        } else if (cmd === 'restore') {
            if (!fromDomain) {
                console.error('Miss to_domain, please see help')
            } else {
                program.toDomain = fromDomain;
                program.current = 'target';
            }
        }
    })
    .usage('<save,restore,sync> [path]')
    .option('-t, --theme [theme_id]', 'Upload theme. If theme_id ommit, deal all themes. If dont have default theme, create one. Please avoid same name.')
    .option('-d, --domain-config', 'Upload domanin config')
    .option('-w, --widget', 'Upload widget')
    .option('-u, --user <account:password>', 'This argument is higher priority than env.EXO_W_USER')
    .option('-f, --force', 'Force update')
    .option('-p, --path <path>', 'Saving path');

program.parse(process.argv);

var task = {
    widgetId: settings.source.widgetId,
    themeId: settings.source.themeId || '',

    // normalize file paths
    origPath: path.normalize(program.opt.path || './'),
    path: '',
    source: {
        domain: program.fromDomain || '',
        // session control
        auth: {
            username: settings.source.username || process.env.EXO_W_USER,
            password: settings.source.password || process.env.EXO_W_USER
        },
        cookie: ''
    },
    target: {
        domain: program.toDomain || '',
        auth: {
            username: settings.target.username || process.env.EXO_W_PASS,
            password: settings.target.password || process.env.EXO_W_PASS
        },
        cookie: ''
    },
    current: program.current
};

task.path = task.origPath;

if (program.user) {
    task.auth.username = program.user.split(':')[0];
    task.auth.password = program.user.split(':')[1];
}

task.host = task.fromDomain;

authenticate(task).then(function(task) {
    return uploader.checkSession(task);
}).then(function(task) {
    return saveCookie(task.cookie);
}).then(function() {
    command(task);
});

function command(task) {
    if (program.cmd === 'save') {
        if (program.opt.theme) {
            downloadThemes(task);
        }

        if (program.opt.domainConfig) {
            downloadDomainConfig(task);
        }

    }

    if (program.cmd === 'restore') {
        task.current = 'traget';

        if (program.opt.theme) {
            uploadThemes(task);
        }

        if (program.opt.domainConfig) {
            uploadDomainConfig(task);
        }
    }

    if (program.cmd === 'sync') {
        if (program.opt.theme) {
            downloadThemes(task).then(function(task) {
                uploadThemes(task);
            });
        } else if (program.opt.domainConfig) {
            downloadDomainConfig(task).then(function(task) {
                uploadDomainConfig(task);
            });
        } else {
            downloadThemes(task).then(function(task) {
                return uploadThemes(task);
            });
            downloadDomainConfig(task).then(function(task) {
                uploadDomainConfig(task);
            });
        }

    }
}

// var yaml = require('js-yaml')
// var config = loadConfig(WIDGET_CONFIG_NAME)

function downloadThemes(task) {
    return uploader.downloadTheme(task).then(function(task) {
        var contain = JSON.parse(task.contain);
        var fsPath = path.join(task.origPath, 'theme/');

        contain.forEach(function(theme, i) {
            theme.name = theme.name.replace(/\s+/g, '_');
            saveFile(fsPath + theme.name + '_' + theme.id + '.json', JSON.stringify(theme, null, 4));
            saveImage(fsPath + 'img_' + theme.name + '_' + theme.id + '/', theme);
        });

        return task
    }).then(function(task) {
        console.log('Save themes success');
        return task;
    }, function() {
        console.log('Save themes fail');
    });
}

function uploadThemes(task) {
    var deferred = Q.defer();
    var promise = [];
    var fsPath = path.join(task.origPath, 'theme/');
    var files = fs.readdirSync(fsPath);
    var themesName = [];
    var fileMap = {};
    task.current = 'target';

    files.forEach(function(v, i) {
        if (v.match(/.json/)) {
            themesName.push(v);
        }
    });

    uploader.downloadTheme(task)
        .then(function(task) {
            var sourceThemes = JSON.parse(task.contain);
            task.idMap = {};

            sourceThemes.forEach(function(v, i) {
                task.idMap[v.name] = {
                    id: v.id,
                    description: v.description
                };
            });

            themesName.forEach(function(fileName, i) {
                task.path = path.join(task.origPath, 'theme', fileName);
                promise.push(uploadTheme(task));
            });

            Q.all(promise).then(function() {
                console.log('Upload themes success');
                deferred.resolve();
            }, function() {
                console.log('Upload themes fail');
                deferred.reject();
            });
        });

    return deferred.promise;
}

function uploadTheme(task) {
    var deferred = Q.defer();
    // uploadImage(task);

    readFile(task).then(function(task) {
        var name = task.fileContent.name;

        if (task.idMap[name]) {
            task.themeId = task.idMap[name].id;
            return uploader.uploadTheme(task);
        } else {
            return uploader.createTheme(task).then(function(task) {
                console.log('Theme %s not exist, create new theme', name);
                return uploader.uploadTheme(task);
            });
        }
    }).then(function(task) {
        deferred.resolve();
    }, function() {
        console.error('Upload theme fail');
        deferred.reject();
    });
    return deferred.promise;
}

function saveImage(path, theme) {
    var deferred = Q.defer();
    //if dir not exist, create it.
    fs.ensureDir(path, function(err) {
        if (err) {
            return console.error(err)
        }

        ['header_logo', 'header_bkimage', 'dashboard_thumbnail', 'browser_tab_icon'].forEach(function(v, i) {
            var url = theme.config[v];
            var options = {
                url: url,
                strictSSL: false,
                followRedirect: false
            };
            if (url) {
                var writeStream = fs.createWriteStream(path + v + '.png', 'utf8');
                request(options).pipe(writeStream);
            }
        });

    });

    return deferred.promise;
}

// Don't work now
function uploadImage(task) {
    uploader.fetchTheme(task).then(function(res) {
        console.log('res ', res);
    });
}

function downloadDomainConfig(task) {
    return uploader.downloadDomainConfig(task)
        .then(function(task) {
            task.contain = JSON.stringify(JSON.parse(task.contain), null, 4);
            return saveFile(task.origPath + 'domain_config.json', task.contain).then(function() {
                return task;
            });
        }).then(function(task) {
            console.log('Save domain config success');
            return task;
        }, function() {
            console.error('Save domain config fail');
        });;
}

function uploadDomainConfig(task) {
    return readFile(task, task.origPath + 'domain_config.json')
        .then(function(task) {
            return uploader.uploadDomainConfig(task);
        }).then(function() {
            console.log('Restore domain config success');
        }, function() {
            console.error('Restore domain config fail');
        });
}

function readFile(task, path) {
    var deferred = Q.defer();
    var fsReadFile = Q.denodeify(fs.readFile);
    this.path = path || task.path;

    fsReadFile(this.path, 'utf-8')
        .then(function(fileContent) {
            task.fileContent = JSON.parse(fileContent);
            deferred.resolve(task);
        }, function(err) {
            console.error('Read file fail');
            deferred.reject('Failed to read file');
        });

    return deferred.promise;
}

function saveFile(fsPath, contains) {
    var deferred = Q.defer();

    fs.ensureDir(path.dirname(fsPath), function() {
        var fsWriteFile = Q.denodeify(fs.writeFile);

        fsWriteFile(fsPath, contains)
            .then(function() {
                debug("The file was saved!");
                deferred.resolve();
            }).catch(function(err) {
                deferred.reject('Failed to wirte file');
            });
    });

    return deferred.promise;
}

function authenticate(task) {
    var deferred = Q.defer();

    var useCookie = function(cookie) {
        debug(cookie);

        task[task.current].cookie = cookie;

        if (!cookie[task[task.current].domain]) {
            promptPwd('cookie not found ');
            return;
        }

        deferred.resolve(task);
    };

    var promptPwd = function(err) {
        debug('no cookies found');

        if (task.auth.username) {
            debug('prompt');

            promptPassword().spread(function(pwd) {
                task.auth.password = pwd;
                deferred.resolve(task);
            });
        } else {
            deferred.reject('require authentication to proceed ');
        }
    };

    loadCookie()
        .then(useCookie)
        .fail(promptPwd);

    return deferred.promise;
}

function promptPassword() {
    var read = require('read');

    return Q.nfcall(read, {
        prompt: 'Password: ',
        silent: true
    });
}

function loadCookie() {
    return Q.nfcall(fs.readFile, COOKIE_PATH, 'utf8').then(JSON.parse);
}

function saveCookie(cookie) {
    return Q.nfcall(fs.writeFile, COOKIE_PATH, JSON.stringify(cookie), 'utf8');
}

function loadConfig(filename) {
    var config = {}
    var file = WIDGET_INIT_CWD + '/' + filename

    if (fs.existsSync(file + '.json')) {
        config = JSON.parse(fs.readFileSync(file + '.json'))
    } else if (fs.existsSync(file + '.yml')) {
        config = yaml.safeLoad(fs.readFileSync(file + '.yml'))
    } else {
        throw 'Missing ' + WIDGET_CONFIG_NAME + ' file.'
    }

    if (!config.name) throw 'Missing name in config'
    if (!config.build) throw 'Missing build in config'
    if (!config.script) throw 'Missing script in config'

    config.template = config.template || []

    config.style = (config.style || []).map(function(path) {
        return WIDGET_INIT_CWD + '/' + path
    })

    config.script = config.script.map(function(path) {
        return WIDGET_INIT_CWD + '/' + path
    }).concat('!gulpfile.js')

    config.auth = config.auth || {
        username: process.env.EXO_W_USER,
        password: process.env.EXO_W_PASS
    }

    return config
}
