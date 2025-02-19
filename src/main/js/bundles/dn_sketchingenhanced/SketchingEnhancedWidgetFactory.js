/*
 * Copyright (C) 2020 con terra GmbH (info@conterra.de)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import Binding from 'apprt-binding/Binding';
import Vue from 'apprt-vue/Vue';
import VueDijit from 'apprt-vue/VueDijit';
import SketchingWidget from './SketchingBase.vue';
import {whenOnce, watch} from 'esri/core/watchUtils';

export default class SketchingEnhancedWidgetFactory {

    createInstance() {
        const vm = new Vue(SketchingWidget);

        const measurementBinding = Binding.for(vm, this._measurementModel);

        measurementBinding
            .syncAll('showLineMeasurementsAtPolylines')
            .syncAll('showLineMeasurementsAtPolygons')
            .syncAll('showAngleMeasurementsAtPolylines')
            .syncAll('enableAngleMeasurement')
            .syncAll('angleUnit')
            .syncAll('currentLength')
            .syncAll('aggregateLength')
            .syncAll('totalLength')
            .syncAll('area')
            .syncAll('currentArea')
            .syncAll('perimeter')
            .syncAll('coordinates')
            .syncAll('pointEnabled')
            .syncAll('polylineEnabled')
            .syncAll('polygonEnabled')
            .syncAll('areaEnabled')
            .syncAll('multiMeasurement')
            .syncToLeftNow()
            .enable();

        const props = this._properties;
        const tools = props.tools;
        vm.toolIds = tools;
        vm.units = props.measurementUnits;
        vm.showKeepMeasurements = props.showKeepMeasurements;
        vm.firstToolGroupIds = props.firstToolGroupIds;
        vm.lastToolGroupIds = props.lastToolGroupIds;
        //vm.footerToolIds = props.footerToolIds;
        vm.headerToolIds = props.headerToolIds;
        vm.measurementEnabled = this._measurementModel.measurementEnabled;
        this._measurementModel.lineMeasurementTimeout = props.lineMeasurementTimeout;

        vm.measurement = props.measurement;

        Object.assign(vm, {
            constructionModel: this._constructionModel,
        });

        if (props.multipleMeasurementsEnabled){
            this._measurementHandler.multiMeasurement = props.multipleMeasurementsEnabled;
        }

        // loading symbol settings from sketching Handler properties
        vm.initialSymbolSettings = this._sketchingHandler._properties.sketch;

        const allTools = tools.operator.concat(tools.draw).concat(tools.edit);

        this._bindingToolsToViewModel.binding(vm, 'tools', allTools, props.toggleTool, props.defaultTool);

        vm.$on('length-unit-input', val => {
            this._measurementHandler.setLengthUnits(val.toLowerCase());
        });

        vm.$on('area-unit-input', val => {
            this._measurementHandler.setAreaUnits(val.toLowerCase());
        });

        vm.$on('coordinate-system-input', val => {
            this._measurementHandler.setCoordinatesystem(val);
        });

        vm.$on('measurementStatusChanged', val => {
            this._measurementModel.measurementEnabled = this.measurementEnabled = vm.measurementEnabled = val;
        });

        vm.$on('settingsSelectionChanged', settings => {
            this._activateHelpLine(settings);
            this._setSettings(settings);
            this._drawFurtherGeometries.styleContext = this._styleContextChangeController._styleContext;
            // use dn_sketchingenhanced-styles bundle to adjust the selected styles
            this._styleContextChangeController._informAboutStyleChange();
        });

        vm.$on('toggleSketchingLayerVisibility', visible => {
            whenOnce(this._mapWidgetModel, 'ready', () => {
                whenOnce(this._mapWidgetModel.view, 'ready', () => {
                    const index = this._mapWidgetModel.view.map.layers.items.findIndex(item => item.id === this._sketchingHandler._properties.graphicLayerId);
                    this._mapWidgetModel.view.map.layers.items[index].visible = visible;
                });
            });

        });

        // watch on changes in sketching layer visibility from somewhere else (e.g. ToC)
        whenOnce(this._mapWidgetModel, 'ready', () => {
            whenOnce(this._mapWidgetModel.view, 'ready', () => {
                const sketchingGraphics = this._mapWidgetModel.map.findLayerById(this._sketchingHandler._graphicLayerId);
                if (sketchingGraphics && sketchingGraphics.graphics && sketchingGraphics.graphics.length > 0) {
                    vm.hasGraphicsOnLoad = true;
                }
                const index = this._mapWidgetModel.view.map.layers.items.findIndex(item => item.id === this._sketchingHandler._properties.graphicLayerId);
                watch(this._mapWidgetModel.view.map.layers.items[index], 'visible', val => {
                    vm.$emit('sketchingLayerVisibilityChanged', val)
                });
            });
        });

        const that = this;
        // if reshape tool is used to edit a sketching text, the text editor is opened
        this._sketchingHandler.sketchViewModel.on('openSketchingEditor', val => {
            if (val) {
                vm.currentSymbol = val.symbol ? val.symbol : vm.currentSymbol;
                vm.openEditorFromReshapeTool = val.openSketchingEditor;
                !val.openSketchingEditor && that._drawTextHelpLine.removeHelpLine(that._sketchingHandler.sketchViewModel);
            }
        });

        if (this._sketchingEnhancedTool){
            this._sketchingEnhancedTool.watch('active', (name, oldValue, active) => {
                if (active === false){
                    this._sketchingHandler.cancel();
                }
            })
        }

        const widget = VueDijit(vm);

        widget.onSketchingActivated = () => this._activateToolOnStartup(vm);

        return widget;
    }

    async _activateToolOnStartup(vm) {
        whenOnce(this._mapWidgetModel, 'ready', () => {
            whenOnce(this._mapWidgetModel.view, 'ready', async () => {
                const id = this._properties.activeToolOnStartup;
                if (!id || !id.length || id === 'none') {
                    return;
                }
                if(id !== 'drawpolylinetool') {
                    vm.onToolClickHandler('drawpolylinetool');
                } else {
                    vm.onToolClickHandler('drawpolygontool')
                }

                await Promise.resolve(new Promise(r => setTimeout(() => r(), 500)));
                if (vm.firstToolGroupIds.includes(id)) {
                    this.clickOnElement(id);
                } else {
                    vm.firstToolGroupIds.forEach(toolId => {
                        const tool = vm._getTool(toolId);
                        if (tool.items && tool.items.includes(id)) {
                            this.clickOnElement(toolId, true);
                            this.clickOnElement(id);
                        }
                    });
                }
            });
        });
    }

    clickOnElement(id, parent) {
        const element = document.getElementById(id);
        if(parent && (element.parentElement.parentElement.className.indexOf('active') !== -1)) {
            return;
        }
        element && element.click();
    }

    _activateHelpLine(settings) {
        const viewModel = this._sketchingHandler.sketchViewModel;
        if (settings.typeName !== 'TextSetting' || !(viewModel.tool && viewModel.tool.toolId === 'drawreshape1tool')) {
            return;
        }

        const dummy = null;
        this._drawTextHelpLine.removeHelpLine(viewModel);
        (viewModel.layer.graphics && viewModel.layer.graphics.items.length > 0) &&
        this._drawTextHelpLine.createHelpLine(dummy, viewModel, settings.angle);
    }

    _setSettings(settings) {
        if (settings.typeName === 'PointSetting') {
            this._setFillColor(settings.color);
            // set marker style and size
            this._setMarkerSettings(settings);
            // set outline Settings:
            this._setLineSettings(settings.outline);
        } else if (settings.typeName === 'LineSetting') {
            this._setLineSettings(settings);
        } else if (settings.typeName === 'PolygonSetting') {
            this._setFillColor(settings.color);
            // set outline settings
            this._setLineSettings(settings.outline);
            // set Polygon fill pattern
            this._setPolygonStyle(settings.style);
        } else {
            // set Text Color and Transparency
            this._setTextColor(settings.textColor);
            // set Text Font (Family, Size, Style, Weight, Decoration)
            this._setTextFont(settings);
            // set Text Halo Color and Size
            this._setTextHalo(settings);
            // set Text Angle
            this._setTextAngle(settings.angle);
        }
    }

    _setFillColor(color) {
        this._styleContextChangeController._styleContext.fillColor = color;
        this._styleContextChangeController._styleContext.fillTransparency = (1 - color.a) * 100;
    }

    _setMarkerSettings(settings) {
        this._styleContextChangeController._styleContext.markerSize = settings.radius;
        this._styleContextChangeController._styleContext.markerStyle = settings.shape;
    }

    _setLineSettings(settings) {
        this._styleContextChangeController._styleContext.strokeColor = settings.color;
        this._styleContextChangeController._styleContext.strokeTransparency = (1 - settings.color.a) * 100;
        this._styleContextChangeController._styleContext.strokeWidth = settings.width;
        this._styleContextChangeController._styleContext.strokeStyle = settings.style;
    }

    _setPolygonStyle(style) {
        this._styleContextChangeController._styleContext.fillStyle = style;
    }

    _setTextColor(color) {
        this._styleContextChangeController._styleContext.textColor = color;
        this._styleContextChangeController._styleContext.textTransparency = (1 - color.a) * 100;
    }

    _setTextFont(settings) {
        this._styleContextChangeController._styleContext.fontSize = settings.textSize;
        this._styleContextChangeController._styleContext.fontWeight = settings.textStyle.bold ? 'bold' : 'normal';
        this._styleContextChangeController._styleContext.fontDecoration = settings.textStyle.underlined ? 'underline' : 'none';
        this._styleContextChangeController._styleContext.fontStyle = settings.textStyle.italic ? 'italic' : 'normal';
        this._styleContextChangeController._styleContext.fontFamily = settings.font;
    }

    _setTextHalo(settings) {
        this._styleContextChangeController._styleContext.textHaloColor = settings.textBlurColor;
        this._styleContextChangeController._styleContext.textHaloSize = settings.textBlurRadius;
    }

    _setTextAngle(angle) {
        this._styleContextChangeController._styleContext.textAngle = angle;
    }
}

