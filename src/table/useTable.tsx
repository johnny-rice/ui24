import React, { Fragment, useEffect, Key } from "react";
import { ITablePropertiesConfig } from "./type";
import { IApiConfig, useApi } from "../core/context";

import { addActionUI } from "./Actions/addActionUI";
import { useAppContext } from "../core/context/AppContext";
import { addFilterUI } from "./Filters/addFilterUI";
import { usePagination } from "./Pagination/usePagination";
import { useAppliedFilters } from "./AppliedFilters/useAppliedFilters";
import { useFormat } from "../core/hooks";

interface IuseTable {
  propertiesConfig: Array<ITablePropertiesConfig>;
  apiConfig: IApiConfig;
  routeParams?: Record<string, string>;
}

const recordPerPage = 10;

// Utility to replace URL parameters with values
const replaceUrlParams = (url: string, params: Record<string, string> = {}) => {
  const result = url.replace(/:(\w+)/g, (_, param) => params[param] || `:${param}`);
  return result;
};

const getFilterPayload = (filters: Record<string, any>, apiMethod: string = "GET") => {
  if( apiMethod === "GET" ) {
    //convention for every filter would be column_operator=value
    //example: name.eq=John
    let transformedFilters: Record<string, any> = {};
    for( let key in filters ) {
      for( let operator in filters[key] ) {
        //if value is array, convert it into a list of values separated by comma
        if( Array.isArray(filters[key][operator]) ) {
          transformedFilters[`${key}.${operator}`] = filters[key][operator].join(",");
        } else {
          transformedFilters[`${key}.${operator}`] = filters[key][operator];
        }
      }
    }
    return transformedFilters;
  }

  return {
    filters: filters
  };
}

export const useTable = ({ propertiesConfig, apiConfig, routeParams = {} }: IuseTable) => {
  const recordIdentifierKey = '__recordIdentifierKey__';
  const identifierColumns = propertiesConfig.filter( property => property.isIdentifier );
  const formattingColumns = propertiesConfig.filter( property => 
    ['date', 'datetime', 'time', 'boolean', 'switch', 'toggle']
      .includes(property.fieldType?.toLocaleLowerCase())
  );

  const [listRecords, setListRecords] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(0);
  const [pageCursor, setPageCursor] = React.useState<Record<number, string>>({});
  const [isLastPage, setIsLastPage] = React.useState(false);
  const [appliedFilters, setAppliedFilters] = React.useState<Record<string, any>>({});
  const { callApiMethod } = useApi();
  const { notifyError } = useAppContext();
  const { formatDate, formatBoolean } = useFormat();
  
  // Track if we've made the initial API call
  const hasInitialLoad = React.useRef(false);
  // Track the last API call parameters to prevent duplicate calls
  const lastCallParams = React.useRef({
    url: '',
    filters: {},
    page: 0,
    cursor: ''
  });

  //call API get records
  const getRecords = React.useCallback(async (
    pageNumber: number = 1,
    currentPageCursor: string = ""
  ) => {
    const apiUrl = replaceUrlParams(apiConfig.apiUrl, routeParams);
    const currentFilters = {...appliedFilters};
    
    // Check if this is a duplicate call
    const callSignature = JSON.stringify({ 
      url: apiUrl, 
      filters: currentFilters,
      page: pageNumber,
      cursor: currentPageCursor
    });
    const lastCallSignature = JSON.stringify(lastCallParams.current);
    if (callSignature === lastCallSignature) {
      return;
    }
    
    // Update last call parameters
    lastCallParams.current = {
      url: apiUrl,
      filters: currentFilters,
      page: pageNumber,
      cursor: currentPageCursor
    };

    const payload = {
      cursor: currentPageCursor,
      limit: recordPerPage,
      ...getFilterPayload(currentFilters, apiConfig.apiMethod),
    };

    setIsLoading(true);

    try {
      const response: any = await callApiMethod({
        ...apiConfig,
        apiUrl,
        payload: payload,
      });

      if (response?.status === 200) {
        const records = response.data[apiConfig.responseKey];

        records.forEach((record: any) => {
          formattingColumns.forEach((property) => {
            if( record[property.dataIndex] === null || record[property.dataIndex] === undefined || record[property.dataIndex] === '' ) {
              record[property.dataIndex] = '';
              return;
            }
            if([ 'date', 'datetime', 'time' ].includes(property.fieldType?.toLocaleLowerCase())){
              const itemValue = record[property.dataIndex].toString().startsWith('0') ? 
                new Date(parseInt(record[property.dataIndex])).toISOString() : 
                record[property.dataIndex];
              record[property.dataIndex] = formatDate(itemValue, property.fieldType?.toLocaleLowerCase() as any);
            } else if (['boolean', 'switch', 'toggle'].includes(property.fieldType?.toLocaleLowerCase())){
              record[property.dataIndex] = formatBoolean(record[property.dataIndex]);
            }
          });

          const identifiers = identifierColumns.map( column => ({
            [column.dataIndex] : record[column.dataIndex]
          }));
          record[recordIdentifierKey] = JSON.stringify(identifiers);
        });

        setListRecords(records);
        setCurrentPage(pageNumber);
        setPageCursor(prev => ({ ...prev, [pageNumber + 1]: response.data?.cursor }));
        setIsLastPage(response.data?.cursor === null);
      } else {
        notifyError(response?.error);
      }
    } catch (error) {
      notifyError('Failed to fetch records');
      console.error('Error fetching records:', error);
    } finally {
      setIsLoading(false);
    }
  }, [apiConfig, routeParams, appliedFilters, formattingColumns, identifierColumns]);

  React.useEffect(() => {
    if (!hasInitialLoad.current && apiConfig.apiUrl) {
      hasInitialLoad.current = true;
      getRecords();
    }
  }, [getRecords]);

  // Handle filter changes separately
  React.useEffect(() => {
    if (hasInitialLoad.current && Object.keys(appliedFilters).length > 0) {
      getRecords();
    }
  }, [appliedFilters, getRecords]);

  const getColumnNameByKey = ( dataIndex: string ) => {
    return columns.find((column) => column.dataIndex === dataIndex)?.title;
  }

  //Filters
  const { applyFilters, DisplayAppliedFilters } = useAppliedFilters({
    appliedFilters,
    setAppliedFilters,
    getColumnNameByKey
  });

  //Pagination
  const { Pagination } = usePagination({
    pageCursor,
    getRecords,
    currentPage,
    isLastPage
  });

  //add action UI and filter UI
  const columns = addFilterUI( addActionUI(propertiesConfig, getRecords ), applyFilters )
  .map( column => { 

    let renderer = column.render;

    if(column.fieldType === 'color'){
      renderer = (text: string, record: any) => {
        return {
          children: <>
            <svg width="12" height="12">
              <rect width="12" height="12" fill={text} strokeWidth={1} stroke="rgb(0,0,0)" />
            </svg>
            <span> {text}</span>
          </>
        }
      }
    }

    return {  ...column, render: renderer}
    
   });

  return { recordIdentifierKey, columns, listRecords, isLoading, Pagination, DisplayAppliedFilters };
};
